/**
 * Entrypoint. Boots adapters, the DB, the risk manager, and a periodic loop
 * that scans -> scores -> evaluates strategies -> emits signals -> trades
 * (paper by default, live only if all gates align).
 *
 * Modes:
 *   --mode=scan    Discovery + scoring only, no trades
 *   --mode=paper   Full pipeline, paper trades (default)
 *   --mode=live    Refuses to start unless cfg.liveModeEnabled
 *
 * The dashboard renders every 5 seconds.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { config } from './config.js';
import { Db } from './db/database.js';
import { JupiterAdapter } from './adapters/jupiter.js';
import { HeliusAdapter } from './adapters/helius.js';
import { BirdeyeAdapter } from './adapters/birdeye.js';
import { DexScreenerAdapter } from './adapters/dexscreener.js';
import { XAdapter } from './adapters/x.js';
import { KillSwitch } from './risk/killSwitch.js';
import { RiskManager } from './risk/riskManager.js';
import { computePositionSize } from './risk/positionSizing.js';
import { CliDashboard } from './dashboard/cliDashboard.js';
import { PaperTrader } from './execution/paperTrader.js';
import { LiveTrader } from './execution/liveTrader.js';
import { ExitManager } from './execution/exitManager.js';
import { JupiterExecutor } from './execution/jupiterExecutor.js';
import { LiquidityScanner } from './scanners/liquidityScanner.js';
import { discoverMultiSource } from './scanners/multiSourceDiscovery.js';
import { WalletScanner } from './scanners/walletScanner.js';
import { WalletDiscovery } from './scanners/walletDiscovery.js';
import { NewsScanner } from './scanners/newsScanner.js';
import { scoreTokenSafety } from './scoring/tokenSafetyScore.js';
import { volumeAccelerationStrategy } from './strategies/volumeAccelerationStrategy.js';
import { liquidityGrowthStrategy } from './strategies/liquidityGrowthStrategy.js';
import { computeMasterSignal, emptyBreakdown } from './scoring/masterSignalScore.js';
import { scoreTooLate } from './scoring/tooLateScore.js';
import { scoreSmartWalletBuys } from './scoring/smartWalletSignal.js';
import { scoreSourceStack, scoreFreshness } from './scoring/discoverySignals.js';
import { migrationStrategy } from './strategies/migrationStrategy.js';
import { scoreEvent } from './scoring/eventScore.js';
import type { MasterSignal, RejectedTrade, TokenSnapshot } from './types.js';

type Mode = 'scan' | 'paper' | 'live';

function modeFromArgv(): Mode {
  const m = process.argv.find((a) => a.startsWith('--mode='));
  if (!m) return 'paper';
  const v = m.split('=')[1];
  if (v === 'scan' || v === 'paper' || v === 'live') return v;
  return 'paper';
}

async function main(): Promise<void> {
  const cfg = config();
  const mode = modeFromArgv();

  // Mode/flag invariants
  if (mode === 'live' && !cfg.liveModeEnabled) {
    console.error(
      chalk.red(
        'Refusing to start in --mode=live: LIVE_TRADING must be true and PAPER_TRADING must be false.',
      ),
    );
    process.exit(2);
  }
  if (mode === 'paper' && cfg.liveModeEnabled) {
    console.error(
      chalk.red(
        'Refusing to start in --mode=paper while LIVE_TRADING=true. Set PAPER_TRADING=true.',
      ),
    );
    process.exit(2);
  }

  const db = new Db(cfg.DB_PATH);
  const jupiter = new JupiterAdapter(cfg.JUPITER_API_KEY);
  const helius = new HeliusAdapter(cfg.HELIUS_API_KEY, cfg.SOLANA_RPC_URL || undefined);
  const birdeye = new BirdeyeAdapter(cfg.BIRDEYE_API_KEY);
  const dex = new DexScreenerAdapter(cfg.DEXSCREENER_API_KEY);
  const x = new XAdapter(cfg.X_BEARER_TOKEN);
  void birdeye;

  const killSwitch = new KillSwitch(cfg.KILL_SWITCH_FILE);
  const risk = new RiskManager(cfg, db, killSwitch);
  const paper = new PaperTrader(cfg, db, jupiter);
  const liquidity = new LiquidityScanner();
  const walletScanner = new WalletScanner(helius, db);
  const walletDiscovery = new WalletDiscovery({ helius, birdeye, dex, db });
  const newsScanner = new NewsScanner(x, dex, birdeye, db);

  let live: LiveTrader | undefined;
  if (mode === 'live') {
    const executor = new JupiterExecutor(
      helius.connection,
      jupiter,
      cfg.PRIVATE_KEY_PATH,
      cfg.WALLET_PUBLIC_KEY,
    );
    // Touch the executor early so the keypair file is validated before trading.
    executor.publicKey();
    live = new LiveTrader(cfg, db, jupiter, executor, helius, risk);
  }

  const exits = new ExitManager(cfg, db, paper, live);
  const dashboard = new CliDashboard(cfg, db, helius, killSwitch);

  console.log(chalk.bold(`Booting in ${mode.toUpperCase()} mode.`));
  if (mode === 'scan') console.log(chalk.gray('Discovery only — no trades will be opened.'));

  const tickIntervalMs = 30_000;
  const dashboardIntervalMs = 5_000;
  const walletPollIntervalMs = 60_000;
  const walletDiscoveryIntervalMs = 10 * 60_000;
  // News polling is conservative because X free tier has very tight
  // monthly read budgets (~100/mo). 30 minutes × N curated accounts is
  // already a meaningful share of the budget for a free user; lower it
  // only if you have paid X access.
  const newsPollIntervalMs = 30 * 60_000;

  setInterval(() => {
    void dashboard.render().catch(() => {});
  }, dashboardIntervalMs);

  // Wallet poll: pulls swap activity from wallets in the watch list and
  // emits "elite wallet bought" signals downstream. Runs every minute.
  if (cfg.ENABLE_SMART_WALLET_TRACKING) {
    setInterval(() => {
      void walletScanner
        .pollOnce()
        .then((signals) => {
          if (signals.length > 0) {
            console.log(chalk.cyan(`[wallet] ${signals.length} new buys from watched wallets`));
          }
        })
        .catch((e: unknown) => {
          db.insertRiskEvent({
            kind: 'rpc_unstable',
            timestamp: Date.now(),
            detail: `walletScanner: ${e instanceof Error ? e.message : String(e)}`,
          });
        });
    }, walletPollIntervalMs);

    // Wallet auto-discovery: examines pools for trending tokens, records who
    // bought early, proposes wallets with breadth across tokens. Conservative
    // labels — never auto-promotes to ELITE_COPYABLE.
    setInterval(() => {
      void walletDiscovery
        .runOnce()
        .then((stats) => {
          if (stats.newObservations > 0 || stats.proposedWallets > 0) {
            console.log(
              chalk.cyan(
                `[discover] ${stats.examinedPools} pools, +${stats.newObservations} obs, +${stats.proposedWallets} proposed`,
              ),
            );
          }
        })
        .catch((e: unknown) => {
          db.insertRiskEvent({
            kind: 'rpc_unstable',
            timestamp: Date.now(),
            detail: `walletDiscovery: ${e instanceof Error ? e.message : String(e)}`,
          });
        });
    }, walletDiscoveryIntervalMs);

    // Run wallet discovery once on boot (after a short delay for warm-up).
    setTimeout(() => {
      void walletDiscovery.runOnce().catch(() => {});
    }, 30_000);
  }

  // News scanner: ingests CA-bearing posts from curated x_accounts into
  // news_events, which the eventScore wiring in evaluate() reads from.
  // Activates only when all three preconditions hold:
  //   1. ENABLE_NEWS_EVENTS feature flag (config default: true)
  //   2. X_BEARER_TOKEN is configured
  //   3. x_accounts table has at least one curated handle
  // When inactive, logs a clear warning at boot and never starts the
  // interval — so an unconfigured user pays no CPU/quota cost and the
  // event score stays at its safe-default 0 documented in DECISIONS.md.
  const xAccountsCount = (
    db.raw().prepare(`SELECT COUNT(*) as c FROM x_accounts`).get() as { c: number }
  ).c;
  const newsActive = cfg.ENABLE_NEWS_EVENTS && x.isConfigured() && xAccountsCount > 0;
  if (cfg.ENABLE_NEWS_EVENTS && !newsActive) {
    const reasons: string[] = [];
    if (!x.isConfigured()) reasons.push('X_BEARER_TOKEN not set');
    if (xAccountsCount === 0) reasons.push('x_accounts is empty');
    console.warn(
      chalk.yellow(
        `NewsScanner inactive: ${reasons.join(' + ')}. Seed curated accounts to enable event scoring (see docs/RUNBOOK.md).`,
      ),
    );
  }
  if (newsActive) {
    setInterval(() => {
      void newsScanner
        .runOnce()
        .then((s) => {
          if (s.persisted > 0) {
            console.log(
              chalk.cyan(
                `[news] +${s.persisted} events from ${s.accounts} curated accounts (fetched ${s.fetched})`,
              ),
            );
          }
        })
        .catch((e: unknown) => {
          db.insertRiskEvent({
            kind: 'rpc_unstable',
            timestamp: Date.now(),
            detail: `newsScanner: ${e instanceof Error ? e.message : String(e)}`,
          });
        });
    }, newsPollIntervalMs);
  }

  // Main pipeline loop
  const loop = async (): Promise<void> => {
    try {
      const discovered = await discoverMultiSource({ dex, birdeye, helius, jupiter });
      const snapshots = discovered.map((d) => d.snapshot);
      const sourcesByMint = new Map(discovered.map((d) => [d.snapshot.address, d.sources]));
      for (const snap of snapshots) {
        db.insertTokenSnapshot(snap);
        const delta = liquidity.observe(snap);
        const signal = await evaluate(snap, mode, {
          cfg,
          risk,
          db,
          jupiter,
          helius,
          discoverySources: sourcesByMint.get(snap.address) ?? [],
        });
        if (!signal) continue;
        db.insertCombinedSignal(signal);

        // Apply trade if recommended
        if (mode === 'scan') continue;

        const balance = cfg.WALLET_PUBLIC_KEY
          ? await helius.getSolBalance(cfg.WALLET_PUBLIC_KEY)
          : 0;
        const sized = computePositionSize(cfg, {
          walletBalanceSol: Math.max(balance, 1),
          strategy: signal.strategy,
          liquidityUsd: snap.liquidityUsd,
          masterScore: signal.masterScore,
          isLaunchpadOrEvent:
            signal.strategy === 'pumpfun_bonding_curve' ||
            signal.strategy === 'official_announcement',
        });
        if (sized.sizeSol <= 0) continue;

        if (
          (mode === 'paper' && (signal.recommendation === 'PAPER_BUY' || signal.recommendation === 'LIVE_BUY_ALLOWED')) ||
          (mode === 'live' && signal.recommendation === 'LIVE_BUY_ALLOWED')
        ) {
          if (mode === 'paper') {
            const r = await paper.openPosition({
              cfg,
              signal,
              snapshot: snap,
              sizeSol: sized.sizeSol,
              reasonOpened: signal.reason,
            });
            if (!r.ok) recordRejection(db, signal, snap, r.reason ?? 'paper open failed');
          } else if (mode === 'live' && live) {
            const r = await live.openPosition({
              signal,
              snapshot: snap,
              sizeSol: sized.sizeSol,
              reasonOpened: signal.reason,
            });
            if (!r.ok) recordRejection(db, signal, snap, r.reason ?? 'live open failed');
          }
        } else if (signal.recommendation === 'PASS' || signal.recommendation === 'WATCH') {
          recordRejection(db, signal, snap, signal.reason);
        }
      }

      // Exit-manager: tick every open position every loop. The previous
      // version only fired when the held token reappeared in discovery,
      // which meant a position whose token dropped off trending could
      // never close. Now we always tick — preferring a fresh snapshot,
      // falling back to a DexScreener fetch (via snapshotFromPair so the
      // result is a real Jupiter-validated snapshot, not a fabricated
      // one), then to the last cached snapshot, then to a synthetic
      // entry-price snapshot for time-based exit.
      const openPositions = db.listOpenPositions();
      for (const p of openPositions) {
        if (mode === 'live' && p.mode === 'paper') continue;
        if (mode === 'paper' && p.mode === 'live') continue;
        const fresh = snapshots.find((s) => s.address === p.token.address);
        let snap = fresh ?? null;
        if (!snap) {
          try {
            const pair = await dex.bestSolanaPair(p.token.address);
            if (pair) {
              const { snapshotFromPair } = await import('./scanners/newTokenScanner.js');
              snap = await snapshotFromPair({ dex, birdeye, helius, jupiter }, pair);
              db.insertTokenSnapshot(snap);
            }
          } catch {
            /* fall through to cached */
          }
        }
        if (!snap) snap = db.getLatestSnapshot(p.token.address);
        if (!snap) {
          // Synthetic minimal snapshot using entry data — at least lets
          // time-based exit close out a stale position.
          snap = {
            address: p.token.address,
            symbol: p.token.symbol,
            name: '',
            pairAddress: null,
            dex: 'unknown',
            liquidityUsd: 0,
            marketCapUsd: 0,
            fdvUsd: 0,
            priceUsd: p.entryPriceUsd,
            priceChange5mPct: 0,
            priceChange1hPct: 0,
            priceChange24hPct: 0,
            volume5mUsd: 0,
            volume15mUsd: 0,
            volume1hUsd: 0,
            volume24hUsd: 0,
            buyCount5m: 0,
            sellCount5m: 0,
            uniqueBuyers5m: 0,
            uniqueSellers5m: 0,
            tokenAgeMinutes: 0,
            poolAgeMinutes: 0,
            jupiterQuoteAvailable: false,
            estPriceImpactPct: null,
            estSlippageBps: null,
            mintAuthorityActive: null,
            freezeAuthorityActive: null,
            top10HolderPct: null,
            topSingleHolderPct: null,
            fetchedAt: Date.now(),
          };
        }
        await exits.tick(p, { snapshot: snap });
      }
    } catch (e) {
      const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      console.error(chalk.red('Loop error:'), detail);
      // Persist so the dashboard's screen-clear doesn't hide it.
      db.insertRiskEvent({ kind: 'rpc_unstable', timestamp: Date.now(), detail: detail.slice(0, 2_000) });
    } finally {
      setTimeout(loop, tickIntervalMs);
    }
  };
  void loop();
}

interface EvalDeps {
  cfg: ReturnType<typeof config>;
  risk: RiskManager;
  db: Db;
  jupiter: JupiterAdapter;
  helius: HeliusAdapter;
  discoverySources: string[];
}

async function evaluate(
  snap: TokenSnapshot,
  mode: Mode,
  deps: EvalDeps,
): Promise<MasterSignal | null> {
  const safety = scoreTokenSafety(deps.cfg, snap);
  deps.db.insertSafetyScore(snap.address, safety.score, safety.label, safety.reasons, snap.fetchedAt);

  // Smart-wallet recent buys: any watched wallet that bought this token in
  // the last hour. Wired into the master signal as smartWallet +
  // smartWalletCluster sub-scores. Also passes the count to liquidityGrowth
  // so it can boost a strategy signal that's already pointing the same way.
  const recentBuys = deps.db.recentSmartWalletBuys(snap.address, 60 * 60);
  const smart = scoreSmartWalletBuys(recentBuys);

  const va = volumeAccelerationStrategy({ cfg: deps.cfg, snapshot: snap });
  const lg = liquidityGrowthStrategy({
    cfg: deps.cfg,
    snapshot: snap,
    delta: null,
    smartWalletEntries: smart.count,
  });

  const tooLate = scoreTooLate({
    snap,
    buzzScoreNow: 0,
    buzzScorePrior: 0,
    eliteSellersLastHour: 0,
    hoursSinceMcDoubled: null,
  });

  const stack = scoreSourceStack(deps.discoverySources);
  const fresh = scoreFreshness(snap.poolAgeMinutes);

  // Migration sub-score: fires when discovery surfaced this token via the
  // migration scanner (a token that just graduated from a bonding-curve
  // launchpad to a real DEX). The strategy already has unit-test coverage;
  // the inputs it needs that aren't yet wired into the bot (buzz) default
  // to neutral, so this is purely a wiring change — the strategy never
  // sees stale data when migration didn't surface the token.
  let migrationScore: number | null = null;
  let migrationConfirmations: string[] = [];
  let migrationWarnings: string[] = [];
  if (deps.discoverySources.includes('migration')) {
    // Heuristic proxies for the strategy's optional inputs:
    //   preMigrationOrganic: high unique-buyers-to-tx ratio in 5m window
    //   alreadyExhausted:    >100% price move in last hour
    const totalTx5m = snap.buyCount5m + snap.sellCount5m;
    const preMigrationOrganic =
      totalTx5m > 0 && snap.uniqueBuyers5m >= 5 && snap.uniqueBuyers5m / totalTx5m >= 0.5;
    const alreadyExhausted = snap.priceChange1hPct > 100;
    const m = migrationStrategy({
      cfg: deps.cfg,
      candidate: {
        snapshot: snap,
        fromVenue: 'pump_fun_curve',
        toVenue: snap.dex,
        migrationDetectedAt: snap.fetchedAt,
      },
      buzzScore: 0,           // buzz module not wired yet
      smartWalletEntries: smart.count,
      preMigrationOrganic,
      alreadyExhausted,
    });
    migrationScore = m.score;
    migrationConfirmations = m.confirmations;
    migrationWarnings = m.warnings;
  }

  // Event sub-score: fires only when the news_events table has a row
  // mentioning this token within the last 6 hours. Production today:
  // newsScanner is not yet instantiated, so news_events is empty and
  // this branch is always a no-op (breakdown.event stays 0). When the
  // newsScanner gets enabled later, this wiring is already in place —
  // no second integration step needed.
  let eventScoreVal: number | null = null;
  let eventReasons: string[] = [];
  const newsEvent = deps.db.recentNewsEventForToken(snap.address);
  if (newsEvent) {
    const postAgeMin = Math.max(0, (Date.now() - newsEvent.publishedAt) / 60_000);
    const ev = scoreEvent({
      sourceCredibility: newsEvent.credibility,
      // Conservative defaults for the confirmation flags — we only have
      // the snapshot's authoritative checks. The newsScanner records the
      // CA-in-post linkage at insert time but doesn't expose individual
      // confirmation flags through this query, so we assume the CA was
      // present in the source if we found it via tokens_json. The other
      // two flags reflect whether DexScreener/Birdeye returned data for
      // this token (proxied via the snapshot).
      caInOfficialSource: true,
      caOnDexScreener: snap.pairAddress !== null,
      caOnBirdeye: snap.top10HolderPct !== null,
      competingCAs: 1,
      buzzScore: 0,                 // buzz module not wired yet
      smartWalletScore: smart.smartWallet,
      volumeAccelerationScore: va.score,
      snap,
      safetyScore: safety.score,
      postAgeMinutes: postAgeMin,
      narrativeScore: 0,            // narrative module not wired yet
    });
    eventScoreVal = ev.score;
    eventReasons = ev.reasons;
  }

  const breakdown = emptyBreakdown();
  breakdown.tokenSafety = safety.score;
  breakdown.smartWallet = smart.smartWallet;
  breakdown.smartWalletCluster = smart.smartWalletCluster;
  breakdown.volumeAcceleration = va.score;
  breakdown.liquidityGrowth = lg.score;
  breakdown.jupiterExecutionQuality = snap.jupiterQuoteAvailable
    ? Math.round(100 - Math.min(100, (snap.estPriceImpactPct ?? 0) * 10))
    : 0;
  breakdown.sourceStack = stack.score;
  breakdown.freshness = fresh.score;
  if (migrationScore !== null) breakdown.migration = migrationScore;
  if (eventScoreVal !== null) breakdown.event = eventScoreVal;
  breakdown.tooLatePenalty = tooLate.penalty;
  breakdown.riskManagerApproved = true; // re-checked at trade time

  // Strategy chooser: smart-wallet cluster wins when it's strong (it's a
  // direct copy-trade signal), otherwise prefer whichever of volume / liq
  // is hotter. EMERGENCY_EXIT from liquidity-drain still wins overall.
  let strategy: MasterSignal['strategy'];
  if (lg.recommendation === 'EMERGENCY_EXIT') {
    strategy = 'liquidity_growth';
  } else if (smart.smartWalletCluster >= 70 || smart.smartWallet >= 80) {
    strategy = 'smart_wallet_cluster';
  } else if (va.score >= lg.score) {
    strategy = 'volume_acceleration';
  } else {
    strategy = 'liquidity_growth';
  }

  const signal = computeMasterSignal({
    cfg: deps.cfg,
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    strategy,
    breakdown,
    confirmations: [...va.confirmations, ...lg.confirmations, ...stack.notes, ...fresh.notes, ...smart.notes, ...migrationConfirmations],
    risks: [...va.warnings, ...lg.warnings, ...tooLate.reasons, ...fresh.warnings, ...migrationWarnings, ...eventReasons],
  });

  if (mode === 'scan') return signal;

  // Final risk gate (with null quote — paper rejects fall through to estimates)
  const approval = deps.risk.approve({
    signal,
    snapshot: snap,
    quote: null,
    walletBalanceSol: 1, // dummy for paper
    intendedMode: mode === 'live' ? 'live' : 'paper',
    now: Date.now(),
  });
  for (const ev of approval.riskEvents) deps.db.insertRiskEvent(ev);
  if (!approval.approved) {
    recordRejection(deps.db, signal, snap, approval.reasons.join('; '));
    return null;
  }
  return signal;
}

function recordRejection(db: Db, signal: MasterSignal, snap: TokenSnapshot, reason: string): void {
  const r: RejectedTrade = {
    tokenAddress: snap.address,
    symbol: snap.symbol,
    strategy: signal.strategy,
    timestamp: Date.now(),
    rejectionReason: reason,
    scoreBreakdown: signal.breakdown,
    rawSignal: signal as unknown as Record<string, unknown>,
  };
  db.insertRejectedTrade(r);
}

// Entrypoint check that works on Windows (backslash paths break the naive
// `file://${process.argv[1]}` comparison). Compare resolved file paths.
const isMainModule =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMainModule) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
