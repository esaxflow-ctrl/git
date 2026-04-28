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
import { scoreTokenSafety } from './scoring/tokenSafetyScore.js';
import { volumeAccelerationStrategy } from './strategies/volumeAccelerationStrategy.js';
import { liquidityGrowthStrategy } from './strategies/liquidityGrowthStrategy.js';
import { computeMasterSignal, emptyBreakdown } from './scoring/masterSignalScore.js';
import { scoreTooLate } from './scoring/tooLateScore.js';
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
  void x;
  void birdeye;

  const killSwitch = new KillSwitch(cfg.KILL_SWITCH_FILE);
  const risk = new RiskManager(cfg, db, killSwitch);
  const paper = new PaperTrader(cfg, db, jupiter);
  const liquidity = new LiquidityScanner();
  const walletScanner = new WalletScanner(helius, db);
  const walletDiscovery = new WalletDiscovery({ helius, birdeye, dex, db });

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

  // Main pipeline loop
  const loop = async (): Promise<void> => {
    try {
      const discovered = await discoverMultiSource({ dex, birdeye, helius, jupiter });
      const snapshots = discovered.map((d) => d.snapshot);
      for (const snap of snapshots) {
        db.insertTokenSnapshot(snap);
        const delta = liquidity.observe(snap);
        const signal = await evaluate(snap, mode, { cfg, risk, db, jupiter, helius });
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

      // ---- Exit manager runs on EVERY open position each cycle, regardless
      // of whether the token re-appeared in discovery. Held tokens that
      // stop trending would otherwise be stuck forever (the time-based
      // exit at 180 min wouldn't fire because the loop never reaches the
      // exit tick). For tokens not in this cycle's discovery, we use the
      // latest snapshot we have — for time-based / hard-stop / trailing
      // logic, slightly stale prices are still actionable.
      const openPositions = db.listOpenPositions();
      for (const p of openPositions) {
        const fresh = snapshots.find((s) => s.address === p.token.address);
        let snap = fresh ?? db.getLatestSnapshot(p.token.address);
        if (!snap) {
          // No snapshot at all — try a quick DexScreener fetch so the
          // exit manager has a price to reason about. Fail silently if
          // even that doesn't work; time-based exit will still fire on
          // a synthetic snapshot using the entry price.
          try {
            const pair = await dex.bestSolanaPair(p.token.address);
            if (pair) {
              snap = {
                address: p.token.address,
                symbol: p.token.symbol,
                name: p.token.name,
                pairAddress: pair.pairAddress,
                dex: 'unknown',
                liquidityUsd: pair.liquidity?.usd ?? 0,
                marketCapUsd: pair.marketCap ?? 0,
                fdvUsd: pair.fdv ?? 0,
                priceUsd: Number(pair.priceUsd ?? 0),
                priceChange5mPct: pair.priceChange?.m5 ?? 0,
                priceChange1hPct: pair.priceChange?.h1 ?? 0,
                priceChange24hPct: pair.priceChange?.h24 ?? 0,
                volume5mUsd: pair.volume?.m5 ?? 0,
                volume15mUsd: 0,
                volume1hUsd: pair.volume?.h1 ?? 0,
                volume24hUsd: pair.volume?.h24 ?? 0,
                buyCount5m: pair.txns?.m5?.buys ?? 0,
                sellCount5m: pair.txns?.m5?.sells ?? 0,
                uniqueBuyers5m: pair.txns?.m5?.buys ?? 0,
                uniqueSellers5m: pair.txns?.m5?.sells ?? 0,
                tokenAgeMinutes: 0,
                poolAgeMinutes: 0,
                jupiterQuoteAvailable: true,
                estPriceImpactPct: null,
                estSlippageBps: null,
                mintAuthorityActive: null,
                freezeAuthorityActive: null,
                top10HolderPct: null,
                topSingleHolderPct: null,
                fetchedAt: Date.now(),
              };
            }
          } catch {
            /* ignore — fallthrough to entry-price synthetic */
          }
        }
        if (!snap) {
          // Last-resort synthetic snapshot using the entry price. The
          // time-based exit only needs `now - entryTimestamp`, so this
          // unblocks stuck positions even when all data sources are dark.
          snap = {
            address: p.token.address,
            symbol: p.token.symbol,
            name: p.token.name,
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
}

async function evaluate(
  snap: TokenSnapshot,
  mode: Mode,
  deps: EvalDeps,
): Promise<MasterSignal | null> {
  const safety = scoreTokenSafety(deps.cfg, snap);
  deps.db.insertSafetyScore(snap.address, safety.score, safety.label, safety.reasons, snap.fetchedAt);
  const va = volumeAccelerationStrategy({ cfg: deps.cfg, snapshot: snap });
  const lg = liquidityGrowthStrategy({
    cfg: deps.cfg,
    snapshot: snap,
    delta: null,
    smartWalletEntries: 0,
  });

  const tooLate = scoreTooLate({
    snap,
    buzzScoreNow: 0,
    buzzScorePrior: 0,
    eliteSellersLastHour: 0,
    hoursSinceMcDoubled: null,
  });

  const breakdown = emptyBreakdown();
  breakdown.tokenSafety = safety.score;
  breakdown.volumeAcceleration = va.score;
  breakdown.liquidityGrowth = lg.score;
  breakdown.jupiterExecutionQuality = snap.jupiterQuoteAvailable
    ? Math.round(100 - Math.min(100, (snap.estPriceImpactPct ?? 0) * 10))
    : 0;
  breakdown.tooLatePenalty = tooLate.penalty;
  breakdown.riskManagerApproved = true; // re-checked at trade time

  const signal = computeMasterSignal({
    cfg: deps.cfg,
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    strategy:
      lg.recommendation === 'EMERGENCY_EXIT'
        ? 'liquidity_growth'
        : va.score >= lg.score
          ? 'volume_acceleration'
          : 'liquidity_growth',
    breakdown,
    confirmations: [...va.confirmations, ...lg.confirmations],
    risks: [...va.warnings, ...lg.warnings, ...tooLate.reasons],
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
