/**
 * Wallet auto-discovery.
 *
 * Looks at recently-trending tokens, fetches the first ~100 swaps through
 * each pool via Helius, and records every wallet that bought. Once a wallet
 * appears in 3+ tokens, it gets *proposed* for the watch list with a
 * **conservative** label (`GOOD_BUT_RISKY` at most — never `ELITE_COPYABLE`
 * automatically).
 *
 * Why conservative: distinguishing "smart money" from insiders/devs/snipers
 * is genuinely hard. Auto-promoting to ELITE would copy-trade insiders into
 * rugs. Promotion to ELITE requires you to look at the wallet, check it
 * isn't deployer-funded, and run `pnpm wallet:add <addr>` manually with
 * label=ELITE_COPYABLE.
 *
 * Heuristics applied automatically:
 *   - Wallet that bought < 3 seconds after pool creation = SNIPER_BOT
 *   - Wallet that appears in 3-5 tokens with positive avg PnL = GOOD_BUT_RISKY
 *   - Wallet appearing in 6+ tokens consistently = GOOD_BUT_RISKY (not ELITE)
 *   - Wallet with mostly losing observations = LOW_QUALITY
 *
 * The "approx PnL" is computed by snapshotting the token's max market cap
 * after the wallet's buy — it's a *peak* not a realised number, so treat
 * the metric as directional, not literal.
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
  proposedWallets: number;
  skippedAlreadyExamined: number;
}

const MAX_POOLS_PER_RUN = 15;          // stay polite to Helius free tier
const MAX_SWAPS_PER_POOL = 100;
const POOL_RE_EXAMINE_MS = 6 * 60 * 60_000; // re-examine same pool every 6h
const MIN_TOKENS_FOR_PROPOSAL = 3;
const SNIPER_THRESHOLD_SECONDS = 3;

export class WalletDiscovery {
  constructor(private readonly deps: WalletDiscoveryDeps) {}

  async runOnce(): Promise<DiscoveryStats> {
    const stats: DiscoveryStats = {
      examinedPools: 0,
      newObservations: 0,
      proposedWallets: 0,
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
      const earlyBuyers = extractEarlyBuyers(txs, t.address);
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

    // 2. Propose wallets that show breadth across many tokens.
    stats.proposedWallets = this.proposeFromObservations();

    return stats;
  }

  /** Read wallet_observations and decide who to add to watched_wallets. */
  private proposeFromObservations(): number {
    type Row = {
      wallet: string;
      tokens: number;
      avg_pnl: number | null;
      avg_pool_age: number | null;
      min_pool_age: number | null;
    };
    const rows = this.deps.db
      .raw()
      .prepare(
        `SELECT wallet,
                COUNT(*) as tokens,
                AVG(approx_pnl_pct) as avg_pnl,
                AVG(pool_age_at_buy_seconds) as avg_pool_age,
                MIN(pool_age_at_buy_seconds) as min_pool_age
         FROM wallet_observations
         GROUP BY wallet
         HAVING tokens >= ?`,
      )
      .all(MIN_TOKENS_FOR_PROPOSAL) as Row[];

    const existingStmt = this.deps.db.raw().prepare(`SELECT 1 FROM watched_wallets WHERE address = ?`);
    const insertStmt = this.deps.db.raw().prepare(
      `INSERT OR IGNORE INTO watched_wallets(address, label, score, notes, added_at) VALUES(?,?,?,?,?)`,
    );

    let proposed = 0;
    for (const r of rows) {
      if (existingStmt.get(r.wallet)) continue;

      const { label, score, notes } = decideLabelAndScore(r);
      // Only ever auto-add NON-ELITE. Human review required to promote.
      if (label === 'IGNORE') continue;
      const result = insertStmt.run(r.wallet, label, score, notes, Date.now());
      if (result.changes > 0) proposed++;
    }
    return proposed;
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

function decideLabelAndScore(r: {
  tokens: number;
  avg_pnl: number | null;
  avg_pool_age: number | null;
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

  // Mostly losing wallet — skip.
  if (r.avg_pnl !== null && r.avg_pnl < -10 && r.tokens >= 5) {
    return { label: 'LOW_QUALITY', score: 30, notes: `avg approx PnL ${r.avg_pnl.toFixed(0)}%` };
  }

  // Repeated cross-token buyer with positive directional PnL.
  if (r.tokens >= 6 && (r.avg_pnl ?? 0) > 30) {
    return {
      label: 'GOOD_BUT_RISKY',
      score: 65,
      notes: `${r.tokens} tokens, avg approx PnL +${(r.avg_pnl ?? 0).toFixed(0)}% (peak-based) — review before promoting to ELITE`,
    };
  }

  if (r.tokens >= MIN_TOKENS_FOR_PROPOSAL && (r.avg_pnl ?? 0) > 0) {
    return {
      label: 'GOOD_BUT_RISKY',
      score: 55,
      notes: `${r.tokens} tokens, avg approx PnL +${(r.avg_pnl ?? 0).toFixed(0)}% (peak-based)`,
    };
  }

  return { label: 'IGNORE', score: 0, notes: '' };
}
