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
import { scanNewTokens } from './scanners/newTokenScanner.js';
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

  setInterval(() => {
    void dashboard.render().catch(() => {});
  }, dashboardIntervalMs);

  // Main pipeline loop
  const loop = async (): Promise<void> => {
    try {
      const snapshots = await scanNewTokens({ dex, birdeye, helius, jupiter }, 25);
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

        // Run the exit manager on any open positions for this token
        for (const p of db.listOpenPositions()) {
          if (p.token.address !== snap.address) continue;
          await exits.tick(p, { snapshot: snap, liquidityDelta: delta });
        }
      }
    } catch (e) {
      console.error(chalk.red('Loop error:'), e instanceof Error ? e.message : e);
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
