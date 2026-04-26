/**
 * Replay backtester. Reads token_snapshots ordered by fetched_at and feeds
 * them to a strategy + paper-trader pair, building a BacktestRun summary.
 *
 * This is a starting point — for a serious backtest you want richer historical
 * data than typical free-tier APIs return. Treat results with strong caveats.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { Db } from '../db/database.js';
import { JupiterAdapter } from '../adapters/jupiter.js';
import { PaperTrader } from '../execution/paperTrader.js';
import { ExitManager } from '../execution/exitManager.js';
import { scoreTokenSafety } from '../scoring/tokenSafetyScore.js';
import { volumeAccelerationStrategy } from '../strategies/volumeAccelerationStrategy.js';
import { computeMasterSignal, emptyBreakdown } from '../scoring/masterSignalScore.js';
import type { BacktestRun, TokenSnapshot } from '../types.js';

async function run(): Promise<void> {
  const cfg = config();
  const db = new Db(cfg.DB_PATH);
  const jupiter = new JupiterAdapter(cfg.JUPITER_API_KEY);
  const paper = new PaperTrader(cfg, db, jupiter);
  const exits = new ExitManager(cfg, db, paper);
  const start = Date.now();

  const rows = db
    .raw()
    .prepare(`SELECT raw_json FROM token_snapshots ORDER BY fetched_at ASC LIMIT 5000`)
    .all() as Array<{ raw_json: string }>;
  if (rows.length === 0) {
    console.log('No historical snapshots in DB. Run `pnpm scan` for a while first.');
    db.close();
    return;
  }

  let totalTrades = 0;
  let wins = 0;
  let netPnl = 0;
  let bestTradePnl = -Infinity;
  let worstTradePnl = Infinity;
  let totalHoldMin = 0;
  const perStrategy: Record<string, { trades: number; winRate: number; netPnlSol: number }> = {};

  // Simple replay: for each snapshot, evaluate volume-acceleration strategy +
  // safety. If pass, open paper position; on next snapshots of same token,
  // tick exit manager.
  for (const r of rows) {
    const snap = JSON.parse(r.raw_json) as TokenSnapshot;
    const safety = scoreTokenSafety(cfg, snap);
    if (safety.score < cfg.TOKEN_SAFETY_THRESHOLD) continue;
    const va = volumeAccelerationStrategy({ cfg, snapshot: snap });
    if (va.recommendation !== 'PAPER_BUY') continue;

    const breakdown = emptyBreakdown();
    breakdown.tokenSafety = safety.score;
    breakdown.volumeAcceleration = va.score;
    breakdown.jupiterExecutionQuality = snap.jupiterQuoteAvailable ? 80 : 0;
    breakdown.riskManagerApproved = true;
    const sig = computeMasterSignal({
      cfg,
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      strategy: 'volume_acceleration',
      breakdown,
      confirmations: va.confirmations,
      risks: va.warnings,
    });
    if (sig.recommendation !== 'PAPER_BUY' && sig.recommendation !== 'LIVE_BUY_ALLOWED') continue;

    const entry = await paper.openPosition({
      cfg,
      signal: sig,
      snapshot: snap,
      sizeSol: cfg.MAX_TRADE_SOL,
      reasonOpened: 'backtest:volume-accel',
      now: snap.fetchedAt,
    });
    if (!entry.ok || !entry.position) continue;

    // Walk forward through later snapshots of same token; close on exit.
    const later = db
      .raw()
      .prepare(
        `SELECT raw_json FROM token_snapshots WHERE token_address = ? AND fetched_at > ? ORDER BY fetched_at ASC`,
      )
      .all(snap.address, snap.fetchedAt) as Array<{ raw_json: string }>;
    let closedPnl = 0;
    let heldMin = 0;
    for (const lr of later) {
      const ls = JSON.parse(lr.raw_json) as TokenSnapshot;
      const decision = await exits.tick(entry.position, { snapshot: ls, now: ls.fetchedAt });
      if (decision && decision.fraction >= 1) {
        // The paper trader closed the position; re-derive PnL from DB.
        const closed = db
          .raw()
          .prepare(`SELECT realised_pnl_sol, exit_ts, entry_ts FROM closed_positions WHERE id = ?`)
          .get(entry.position.id) as { realised_pnl_sol: number; exit_ts: number; entry_ts: number } | undefined;
        if (closed) {
          closedPnl = closed.realised_pnl_sol;
          heldMin = (closed.exit_ts - closed.entry_ts) / 60_000;
        }
        break;
      }
    }
    totalTrades++;
    netPnl += closedPnl;
    if (closedPnl > 0) wins++;
    bestTradePnl = Math.max(bestTradePnl, closedPnl);
    worstTradePnl = Math.min(worstTradePnl, closedPnl);
    totalHoldMin += heldMin;
    const k = sig.strategy;
    perStrategy[k] ??= { trades: 0, winRate: 0, netPnlSol: 0 };
    perStrategy[k].trades++;
    perStrategy[k].netPnlSol += closedPnl;
    if (closedPnl > 0) perStrategy[k].winRate += 1;
  }

  for (const k of Object.keys(perStrategy)) {
    const v = perStrategy[k]!;
    v.winRate = v.trades > 0 ? v.winRate / v.trades : 0;
  }

  const result: BacktestRun = {
    id: randomUUID(),
    startedAt: start,
    finishedAt: Date.now(),
    config: { cfg: { ...cfg, profitLadder: cfg.profitLadder } },
    totalTrades,
    winRate: totalTrades > 0 ? wins / totalTrades : 0,
    netPnlSol: netPnl,
    maxDrawdown: 0,
    bestTradePnl: bestTradePnl === -Infinity ? 0 : bestTradePnl,
    worstTradePnl: worstTradePnl === Infinity ? 0 : worstTradePnl,
    avgHoldMinutes: totalTrades > 0 ? totalHoldMin / totalTrades : 0,
    expectancy: totalTrades > 0 ? netPnl / totalTrades : 0,
    profitFactor: 0,
    perStrategy,
  };

  console.log(JSON.stringify(result, null, 2));
  db.close();
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMainModule) {
  run().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

export { run };
