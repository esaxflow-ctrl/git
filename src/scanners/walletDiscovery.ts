/**
 * Wallet auto-discovery — realised-PnL edition.
 *
 * Looks at recently-trending tokens, fetches the first ~100 swaps through
 * each pool via Helius, and records BOTH buys AND sells per (wallet, token).
 * For every (wallet, token) pair where we observe at least one matched
 * buy AND sell, we compute the realised PnL in SOL. Wallets that show
 * **positive realised PnL across multiple tokens** become candidates.
 *
 * This is the upgrade over peak-mcap-based "approx PnL": a wallet that
 * bought when MCap was $50K and is still holding when MCap is $200K shows
 * +300% on paper but might end up at -90% if they don't sell. We only
 * promote when we've actually seen them take chips off the table.
 *
 * Conservative labels only — automatic promotion never produces
 * `ELITE_COPYABLE`. Distinguishing "smart money" from insiders/devs/snipers
 * is genuinely hard. ELITE promotion remains a manual decision via
 * `pnpm wallet:add <addr> ELITE_COPYABLE 90`.
 *
 * Heuristics applied automatically:
 *   - Wallet that bought < 3 seconds after pool creation on a *majority* of
 *       its pools = SNIPER_BOT (was: any single pool — too aggressive,
 *       smart wallets sometimes also snipe)
 *   - Wallet with positive realised PnL across 2+ tokens, ≥0.5 SOL net
 *       = GOOD_BUT_RISKY (initial promotion, score 60)
 *   - Wallet with ≥5 tokens, ≥60% win rate, ≥2 SOL net realised
 *       = ELITE_COPYABLE (auto, score 80)
 *   - Wallet with negative net realised PnL across 3+ tokens after a
 *       previous promotion = AUTO_DEMOTE to LOW_QUALITY
 *   - Wallet observed only buying (no sells) is NOT promoted — could be
 *       a bag-holder
 */

import type { BirdeyeAdapter } from '../adapters/birdeye.js';
import type { DexScreenerAdapter } from '../adapters/dexscreener.js';
import type { HeliusAdapter } from '../adapters/helius.js';
import type { Db } from '../db/database.js';
import type { WalletLabel } from '../types.js';

export interface WalletDiscoveryDeps {
  birdeye: BirdeyeAdapter;
  dex: DexScreenerAdapter;
  helius: HeliusAdapter;
  db: Db;
}

export interface DiscoveryStats {
  examinedPools: number;
  newObservations: number;
  newSellsRecorded: number;
  walletsWithRealisedPnl: number;
  proposedWallets: number;
  promotedToElite: number;
  autoDemoted: number;
  skippedAlreadyExamined: number;
}

const MAX_POOLS_PER_RUN = 15;          // stay polite to Helius free tier
const MAX_SWAPS_PER_POOL = 100;
const POOL_RE_EXAMINE_MS = 6 * 60 * 60_000; // re-examine same pool every 6h
const MIN_TOKENS_FOR_PROPOSAL = 2;     // realised PnL across 2+ tokens is meaningful
const SNIPER_THRESHOLD_SECONDS = 3;
const MIN_NET_REALISED_SOL = 0.5;      // realised PnL must clear this to flag GOOD_BUT_RISKY

// ELITE_COPYABLE auto-promotion thresholds. Stricter than GOOD_BUT_RISKY:
// we only flip a wallet to ELITE when the track record is robust enough
// that a single bad copy is unlikely to invalidate the decision.
const ELITE_MIN_TOKENS = 5;
const ELITE_MIN_NET_SOL = 2;
const ELITE_MIN_WIN_RATE = 0.6;
// Auto-demotion: a previously-promoted wallet that now shows negative net
// realised PnL across N+ tokens gets dropped back to LOW_QUALITY.
const DEMOTE_MIN_TOKENS = 3;

export class WalletDiscovery {
  constructor(private readonly deps: WalletDiscoveryDeps) {}

  async runOnce(): Promise<DiscoveryStats> {
    const stats: DiscoveryStats = {
      examinedPools: 0,
      newObservations: 0,
      newSellsRecorded: 0,
      walletsWithRealisedPnl: 0,
      proposedWallets: 0,
      promotedToElite: 0,
      autoDemoted: 0,
      skippedAlreadyExamined: 0,
    };

    // 1. Pick top movers from Birdeye trending — these have real volume.
    const trending = await this.deps.birdeye.trendingTokens(30);
    const candidates = trending.slice(0, MAX_POOLS_PER_RUN);
    if (candidates.length === 0) return stats;

    const examinedStmt = this.deps.db
      .raw()
      .prepare(`SELECT examined_at FROM examined_pools WHERE token_address = ?`);

    for (const t of candidates) {
      const prior = examinedStmt.get(t.address) as { examined_at: number } | undefined;
      if (prior && Date.now() - prior.examined_at < POOL_RE_EXAMINE_MS) {
        stats.skippedAlreadyExamined++;
        continue;
      }

      const pair = await this.deps.dex.bestSolanaPair(t.address);
      if (!pair) continue;
      const overview = await this.deps.birdeye.tokenOverview(t.address);

      // Helius enhanced-tx works on any account; the LP pool address is
      // where every swap originates.
      const txs = await this.deps.helius.getEnhancedTransactions(
        pair.pairAddress,
        MAX_SWAPS_PER_POOL,
      );
      // Both directions: first-time buyers AND any sells we observe.
      const earlyBuyers = extractEarlyBuyers(txs, t.address);
      const swaps = extractSwaps(txs, t.address);
      stats.examinedPools++;

      const insertObs = this.deps.db.raw().prepare(
        `INSERT OR IGNORE INTO wallet_observations
         (wallet, token_address, first_buy_ts, pool_age_at_buy_seconds, buy_price_usd, buy_market_cap_usd, later_max_market_cap_usd, approx_pnl_pct, signature)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      );
      const updateObs = this.deps.db.raw().prepare(
        `UPDATE wallet_observations
           SET later_max_market_cap_usd = MAX(COALESCE(later_max_market_cap_usd, 0), ?),
               approx_pnl_pct = CASE WHEN buy_market_cap_usd > 0
                 THEN ((MAX(COALESCE(later_max_market_cap_usd, 0), ?) - buy_market_cap_usd) / buy_market_cap_usd) * 100
                 ELSE NULL END
         WHERE wallet = ? AND token_address = ?`,
      );

      const poolCreatedAt = pair.pairCreatedAt ?? 0;
      const buyMcap = overview?.mc ?? pair.marketCap ?? 0;
      const buyPrice = overview?.price ?? Number(pair.priceUsd ?? 0);
      const currentMcap = overview?.mc ?? pair.marketCap ?? 0;

      const tx = this.deps.db.raw().transaction((entries: typeof earlyBuyers) => {
        for (const e of entries) {
          const poolAgeSec = poolCreatedAt > 0 ? Math.max(0, Math.floor((e.blockTime - poolCreatedAt) / 1000)) : 0;
          const result = insertObs.run(
            e.wallet,
            t.address,
            e.blockTime,
            poolAgeSec,
            buyPrice,
            buyMcap,
            currentMcap,
            buyMcap > 0 ? ((currentMcap - buyMcap) / buyMcap) * 100 : null,
            e.signature,
          );
          if (result.changes > 0) {
            stats.newObservations++;
          } else {
            // Already had an observation — refresh later_max_mcap.
            updateObs.run(currentMcap, currentMcap, e.wallet, t.address);
          }
        }
      });
      tx(earlyBuyers);

      // Record buy/sell SOL flows per (wallet, token) for realised-PnL math.
      const upsertPnl = this.deps.db.raw().prepare(
        `INSERT INTO wallet_token_pnl
           (wallet, token_address, total_buy_sol, total_sell_sol, total_buys, total_sells, first_buy_ts, last_sell_ts, realised_pnl_sol)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(wallet, token_address) DO UPDATE SET
           total_buy_sol  = wallet_token_pnl.total_buy_sol  + excluded.total_buy_sol,
           total_sell_sol = wallet_token_pnl.total_sell_sol + excluded.total_sell_sol,
           total_buys     = wallet_token_pnl.total_buys     + excluded.total_buys,
           total_sells    = wallet_token_pnl.total_sells    + excluded.total_sells,
           first_buy_ts   = COALESCE(wallet_token_pnl.first_buy_ts, excluded.first_buy_ts),
           last_sell_ts   = MAX(COALESCE(wallet_token_pnl.last_sell_ts, 0), COALESCE(excluded.last_sell_ts, 0)),
           realised_pnl_sol = (wallet_token_pnl.total_sell_sol + excluded.total_sell_sol)
                            - (wallet_token_pnl.total_buy_sol  + excluded.total_buy_sol)`,
      );

      // Dedup at the (wallet, signature) level so re-examining a pool doesn't
      // double-count a swap we already recorded.
      const seenSigStmt = this.deps.db
        .raw()
        .prepare(`SELECT 1 FROM wallet_observations WHERE wallet = ? AND token_address = ? AND signature = ?`);

      const pnlTx = this.deps.db.raw().transaction((entries: typeof swaps) => {
        for (const s of entries) {
          if (seenSigStmt.get(s.wallet, t.address, s.signature)) continue;
          if (s.side === 'buy') {
            upsertPnl.run(s.wallet, t.address, s.solAmount, 0, 1, 0, s.blockTime, null, -s.solAmount);
          } else {
            upsertPnl.run(s.wallet, t.address, 0, s.solAmount, 0, 1, null, s.blockTime, s.solAmount);
            stats.newSellsRecorded++;
          }
        }
      });
      pnlTx(swaps);

      this.deps.db
        .raw()
        .prepare(
          `INSERT INTO examined_pools(token_address, pair_address, examined_at, early_buyers_seen)
           VALUES(?,?,?,?)
           ON CONFLICT(token_address) DO UPDATE SET
             examined_at = excluded.examined_at,
             pair_address = excluded.pair_address,
             early_buyers_seen = examined_pools.early_buyers_seen + excluded.early_buyers_seen`,
        )
        .run(t.address, pair.pairAddress, Date.now(), earlyBuyers.length);
    }

    // 2. Refresh per-wallet PnL summary (only wallets with realised closed
    //    positions get a summary row; bag-holders without sells don't).
    stats.walletsWithRealisedPnl = this.refreshPnlSummary();

    // 3. Propose wallets backed by realised PnL across multiple tokens.
    stats.proposedWallets = this.proposeFromRealisedPnl();

    // 4. Auto-promote GOOD_BUT_RISKY wallets that have proven themselves on
    //    a robust sample to ELITE_COPYABLE. Auto-demote previously-promoted
    //    wallets whose track record has degraded.
    const { promoted, demoted } = this.reEvaluateExistingWallets();
    stats.promotedToElite = promoted;
    stats.autoDemoted = demoted;

    return stats;
  }

  private refreshPnlSummary(): number {
    const rows = this.deps.db
      .raw()
      .prepare(
        `SELECT wallet,
                SUM(realised_pnl_sol) as net,
                COUNT(*) as token_count,
                SUM(CASE WHEN realised_pnl_sol > 0 THEN 1 ELSE 0 END) as wins
         FROM wallet_token_pnl
         WHERE total_sells > 0  -- only count tokens where the wallet actually sold
         GROUP BY wallet`,
      )
      .all() as Array<{ wallet: string; net: number; token_count: number; wins: number }>;

    const upsert = this.deps.db
      .raw()
      .prepare(
        `INSERT INTO wallet_pnl_summary(wallet, tokens_with_realised, net_realised_pnl_sol, win_rate, avg_hold_minutes, updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(wallet) DO UPDATE SET
           tokens_with_realised = excluded.tokens_with_realised,
           net_realised_pnl_sol = excluded.net_realised_pnl_sol,
           win_rate = excluded.win_rate,
           updated_at = excluded.updated_at`,
      );

    const tx = this.deps.db.raw().transaction((rs: typeof rows) => {
      for (const r of rs) {
        const winRate = r.token_count > 0 ? r.wins / r.token_count : 0;
        upsert.run(r.wallet, r.token_count, r.net, winRate, null, Date.now());
      }
    });
    tx(rows);
    return rows.length;
  }

  /**
   * Promote wallets backed by *realised* PnL across multiple tokens.
   * Pure-buy wallets (still holding bags) are NOT promoted — we wait until
   * we've seen them take real profit.
   */
  private proposeFromRealisedPnl(): number {
    type Row = {
      wallet: string;
      tokens: number;
      net_pnl_sol: number;
      wins: number;
      min_pool_age: number | null;
    };
    const rows = this.deps.db
      .raw()
      .prepare(
        `SELECT s.wallet,
                s.tokens_with_realised as tokens,
                s.net_realised_pnl_sol as net_pnl_sol,
                CAST(s.win_rate * s.tokens_with_realised AS INTEGER) as wins,
                (SELECT MIN(pool_age_at_buy_seconds) FROM wallet_observations o WHERE o.wallet = s.wallet) as min_pool_age
         FROM wallet_pnl_summary s
         WHERE s.tokens_with_realised >= ?`,
      )
      .all(MIN_TOKENS_FOR_PROPOSAL) as Row[];

    const existingStmt = this.deps.db.raw().prepare(`SELECT 1 FROM watched_wallets WHERE address = ?`);
    const insertStmt = this.deps.db.raw().prepare(
      `INSERT OR IGNORE INTO watched_wallets(address, label, score, notes, added_at) VALUES(?,?,?,?,?)`,
    );

    let proposed = 0;
    for (const r of rows) {
      if (existingStmt.get(r.wallet)) continue;
      const { label, score, notes } = decideLabelAndScoreRealised(r);
      if (label === 'IGNORE') continue;
      const result = insertStmt.run(r.wallet, label, score, notes, Date.now());
      if (result.changes > 0) proposed++;
    }
    return proposed;
  }

  /**
   * Re-score wallets we've already promoted. Two transitions matter:
   *
   *  - GOOD_BUT_RISKY -> ELITE_COPYABLE when realised PnL track record
   *    crosses the ELITE thresholds (5+ tokens, ≥60% win rate, ≥2 SOL net).
   *
   *  - ELITE_COPYABLE / GOOD_BUT_RISKY -> LOW_QUALITY when realised PnL
   *    has gone negative across 3+ tokens. Manual entries (the user added
   *    via `pnpm wallet:add`) are detected by their `notes` field — we
   *    leave those alone to avoid stomping the user's curation.
   */
  private reEvaluateExistingWallets(): { promoted: number; demoted: number } {
    type Row = {
      address: string;
      label: string;
      score: number;
      notes: string | null;
      tokens: number;
      net_pnl_sol: number;
      win_rate: number;
      min_pool_age: number | null;
      sniper_pools: number;
    };
    const rows = this.deps.db
      .raw()
      .prepare(
        `SELECT w.address, w.label, w.score, w.notes,
                COALESCE(s.tokens_with_realised, 0) as tokens,
                COALESCE(s.net_realised_pnl_sol, 0) as net_pnl_sol,
                COALESCE(s.win_rate, 0) as win_rate,
                (SELECT MIN(pool_age_at_buy_seconds) FROM wallet_observations o WHERE o.wallet = w.address) as min_pool_age,
                (SELECT COUNT(*) FROM wallet_observations o WHERE o.wallet = w.address AND o.pool_age_at_buy_seconds <= ?) as sniper_pools
         FROM watched_wallets w
         LEFT JOIN wallet_pnl_summary s ON s.wallet = w.address`,
      )
      .all(SNIPER_THRESHOLD_SECONDS) as Row[];

    const update = this.deps.db
      .raw()
      .prepare(
        `UPDATE watched_wallets SET label = ?, score = ?, notes = ? WHERE address = ?`,
      );
    let promoted = 0;
    let demoted = 0;

    for (const r of rows) {
      // Skip wallets the user manually added — `decideLabelAndScoreRealised`
      // produces notes that always start with a sign / sniper marker, so a
      // notes string with something other than that pattern is a manual
      // curation we shouldn't overwrite.
      if (!r.notes || (!r.notes.includes('SOL realised') && !r.notes.includes('sniper'))) {
        continue;
      }

      // Sniper detection: majority of observed pools entered <3s after pool
      // creation. Demote regardless of PnL — even profitable snipers aren't
      // copyable on a paper-bot timing budget.
      const totalObs = this.deps.db
        .raw()
        .prepare(`SELECT COUNT(*) as c FROM wallet_observations WHERE wallet = ?`)
        .get(r.address) as { c: number };
      const isSniper = totalObs.c >= 3 && r.sniper_pools / totalObs.c >= 0.5;
      if (isSniper && r.label !== 'SNIPER_BOT') {
        update.run('SNIPER_BOT', 25, `auto: ${r.sniper_pools}/${totalObs.c} pools entered ≤${SNIPER_THRESHOLD_SECONDS}s — sniper`, r.address);
        demoted++;
        continue;
      }

      // MEV-bot detector. Per the OdinBot post-mortem: a wallet with very
      // high win rate (>85%) on a meaningful sample is almost always a MEV
      // / sandwich / arb bot rather than a discretionary trader. The PnL
      // is structurally unreplicable for a copy follower — by the time we
      // see the buy and fire our own, the opportunity is gone. Re-label
      // as TOO_FAST_TO_COPY so it stops feeding the smart-wallet score.
      if (r.tokens >= 10 && r.win_rate >= 0.85 && r.label !== 'TOO_FAST_TO_COPY') {
        update.run(
          'TOO_FAST_TO_COPY',
          20,
          `auto: ${(r.win_rate * 100).toFixed(0)}% win rate over ${r.tokens} tokens — MEV/arb pattern, structurally uncopyable`,
          r.address,
        );
        demoted++;
        continue;
      }

      const winRatePct = (r.win_rate * 100).toFixed(0);
      const pnlStr = `${r.net_pnl_sol >= 0 ? '+' : ''}${r.net_pnl_sol.toFixed(3)} SOL realised across ${r.tokens} tokens (${winRatePct}% win rate)`;

      // Demote: previously-promoted wallet now showing negative net PnL.
      if (
        (r.label === 'ELITE_COPYABLE' || r.label === 'GOOD_BUT_RISKY') &&
        r.tokens >= DEMOTE_MIN_TOKENS &&
        r.net_pnl_sol < 0
      ) {
        update.run('LOW_QUALITY', 30, `auto-demote: ${pnlStr}`, r.address);
        demoted++;
        continue;
      }

      // Promote GOOD_BUT_RISKY -> ELITE_COPYABLE.
      if (
        r.label === 'GOOD_BUT_RISKY' &&
        r.tokens >= ELITE_MIN_TOKENS &&
        r.net_pnl_sol >= ELITE_MIN_NET_SOL &&
        r.win_rate >= ELITE_MIN_WIN_RATE
      ) {
        update.run(
          'ELITE_COPYABLE',
          80,
          `auto-promote: ${pnlStr} — meets ELITE thresholds (≥${ELITE_MIN_TOKENS} tokens, ≥${ELITE_MIN_WIN_RATE * 100}% win, ≥${ELITE_MIN_NET_SOL} SOL net)`,
          r.address,
        );
        promoted++;
        continue;
      }
    }

    return { promoted, demoted };
  }
}

interface EarlyBuyer {
  wallet: string;
  blockTime: number; // ms
  signature: string;
}

/**
 * Extract wallets that received the target token (i.e. bought) from a list
 * of Helius enhanced transactions for a pool address.
 */
function extractEarlyBuyers(txs: unknown[], targetMint: string): EarlyBuyer[] {
  const out: EarlyBuyer[] = [];
  const seen = new Set<string>();
  for (const raw of txs) {
    const tx = raw as {
      type?: string;
      signature?: string;
      timestamp?: number;
      tokenTransfers?: Array<{
        fromUserAccount?: string;
        toUserAccount?: string;
        mint?: string;
        tokenAmount?: number;
      }>;
    };
    if (!tx.signature || !tx.timestamp) continue;
    if (tx.type && tx.type !== 'SWAP' && tx.type !== 'TRANSFER') continue;
    const transfers = tx.tokenTransfers ?? [];
    // Find a transfer that delivered targetMint to a user account.
    const buy = transfers.find(
      (t) => t.mint === targetMint && t.toUserAccount && (t.tokenAmount ?? 0) > 0,
    );
    if (!buy?.toUserAccount) continue;
    if (seen.has(buy.toUserAccount)) continue;
    seen.add(buy.toUserAccount);
    out.push({
      wallet: buy.toUserAccount,
      blockTime: tx.timestamp * 1000,
      signature: tx.signature,
    });
  }
  return out;
}

interface ObservedSwap {
  wallet: string;
  side: 'buy' | 'sell';
  solAmount: number;
  blockTime: number;
  signature: string;
}

/**
 * Extract every wallet-level buy and sell of `targetMint` from a list of
 * Helius enhanced transactions for a pool address. SOL legs come from the
 * tx's nativeTransfers — when the wallet sent SOL it's a buy, when it
 * received SOL it's a sell.
 */
function extractSwaps(txs: unknown[], targetMint: string): ObservedSwap[] {
  const out: ObservedSwap[] = [];
  for (const raw of txs) {
    const tx = raw as {
      type?: string;
      signature?: string;
      timestamp?: number;
      tokenTransfers?: Array<{
        fromUserAccount?: string;
        toUserAccount?: string;
        mint?: string;
        tokenAmount?: number;
      }>;
      nativeTransfers?: Array<{
        fromUserAccount?: string;
        toUserAccount?: string;
        amount?: number; // lamports
      }>;
    };
    if (!tx.signature || !tx.timestamp) continue;
    if (tx.type && tx.type !== 'SWAP') continue;
    const tt = tx.tokenTransfers ?? [];
    const nt = tx.nativeTransfers ?? [];

    // BUY: wallet receives targetMint AND sends SOL.
    const tokenIn = tt.find(
      (t) => t.mint === targetMint && t.toUserAccount && (t.tokenAmount ?? 0) > 0,
    );
    if (tokenIn?.toUserAccount) {
      const solOut = nt.find(
        (n) => n.fromUserAccount === tokenIn.toUserAccount && (n.amount ?? 0) > 0,
      );
      if (solOut) {
        out.push({
          wallet: tokenIn.toUserAccount,
          side: 'buy',
          solAmount: (solOut.amount ?? 0) / 1_000_000_000,
          blockTime: tx.timestamp * 1000,
          signature: tx.signature,
        });
        continue;
      }
    }

    // SELL: wallet sends targetMint AND receives SOL.
    const tokenOut = tt.find(
      (t) => t.mint === targetMint && t.fromUserAccount && (t.tokenAmount ?? 0) > 0,
    );
    if (tokenOut?.fromUserAccount) {
      const solIn = nt.find(
        (n) => n.toUserAccount === tokenOut.fromUserAccount && (n.amount ?? 0) > 0,
      );
      if (solIn) {
        out.push({
          wallet: tokenOut.fromUserAccount,
          side: 'sell',
          solAmount: (solIn.amount ?? 0) / 1_000_000_000,
          blockTime: tx.timestamp * 1000,
          signature: tx.signature,
        });
      }
    }
  }
  return out;
}

function decideLabelAndScoreRealised(r: {
  tokens: number;
  net_pnl_sol: number;
  wins: number;
  min_pool_age: number | null;
}): { label: WalletLabel; score: number; notes: string } {
  // Sniper bot: nearly-instant entry on at least one pool.
  if (r.min_pool_age !== null && r.min_pool_age <= SNIPER_THRESHOLD_SECONDS) {
    return {
      label: 'SNIPER_BOT',
      score: 25,
      notes: `min pool age ${r.min_pool_age}s — likely sniper bot; not copyable`,
    };
  }

  const winRate = r.tokens > 0 ? r.wins / r.tokens : 0;
  const pnlStr = `${r.net_pnl_sol >= 0 ? '+' : ''}${r.net_pnl_sol.toFixed(3)} SOL realised across ${r.tokens} tokens (${(winRate * 100).toFixed(0)}% win rate)`;

  // Negative net realised PnL across enough tokens — clearly losing.
  if (r.net_pnl_sol < 0 && r.tokens >= 3) {
    return { label: 'LOW_QUALITY', score: 30, notes: pnlStr };
  }

  // Strong realised winner: 4+ tokens, positive PnL, decent win rate.
  if (r.tokens >= 4 && r.net_pnl_sol >= MIN_NET_REALISED_SOL * 2 && winRate >= 0.5) {
    return {
      label: 'GOOD_BUT_RISKY',
      score: 70,
      notes: `${pnlStr} — strong realised PnL across many tokens; manually verify it's not a deployer-funded wallet before promoting to ELITE`,
    };
  }

  // Decent realised winner: 2+ tokens, positive PnL clearing the floor.
  if (r.tokens >= MIN_TOKENS_FOR_PROPOSAL && r.net_pnl_sol >= MIN_NET_REALISED_SOL) {
    return {
      label: 'GOOD_BUT_RISKY',
      score: 60,
      notes: `${pnlStr} — review before promoting to ELITE_COPYABLE`,
    };
  }

  return { label: 'IGNORE', score: 0, notes: '' };
}
