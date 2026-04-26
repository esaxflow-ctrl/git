/**
 * Exit manager.
 *
 * For each open position, evaluates exit conditions on every tick:
 *
 *   1. Hard stop loss
 *   2. Trailing stop (engaged after profit)
 *   3. Profit ladder (partial exits at configured % gains)
 *   4. Time-based exit
 *   5. Liquidity drain emergency exit
 *   6. Smart-wallet sell exit (copy-trade positions)
 *   7. Buzz collapse (X-buzz positions)
 *   8. Fake-contract / official-post-deleted (event positions)
 *   9. Kill switch — does NOT auto-flatten by default but disables new entries;
 *      caller can opt to also flatten.
 */

import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import type { OpenPosition, TokenSnapshot } from '../types.js';
import type { PaperTrader } from './paperTrader.js';
import type { LiveTrader } from './liveTrader.js';
import type { LiquidityDelta } from '../scanners/liquidityScanner.js';

export interface ExitContext {
  snapshot: TokenSnapshot;
  liquidityDelta?: LiquidityDelta | null;
  eliteSellersInLastWindow?: number;
  buzzScoreNow?: number;
  buzzScorePrior?: number;
  officialPostDeleted?: boolean;
  fakeContractWarning?: boolean;
  now?: number;
}

export interface ExitDecision {
  fraction: number;       // 0..1
  reason: string;
  emergency: boolean;
}

export class ExitManager {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Db,
    private readonly paper: PaperTrader,
    private readonly live?: LiveTrader,
  ) {}

  /** Pure decision step — useful for tests. */
  decide(position: OpenPosition, ctx: ExitContext): ExitDecision | null {
    const now = ctx.now ?? Date.now();
    const price = ctx.snapshot.priceUsd;
    if (price <= 0) return null;

    // ---- 1. Hard stop loss ----------------------------------------------
    if (price <= position.hardStopPriceUsd) {
      return { fraction: 1, reason: `hard stop: price $${price} <= stop $${position.hardStopPriceUsd}`, emergency: false };
    }

    // ---- 2. Liquidity drain emergency -----------------------------------
    if (ctx.liquidityDelta?.kind === 'drained') {
      return {
        fraction: 1,
        reason: `liquidity drained ${ctx.liquidityDelta.deltaPct.toFixed(1)}% in ${ctx.liquidityDelta.withinSeconds.toFixed(0)}s`,
        emergency: true,
      };
    }

    // ---- 3. Fake contract / deleted post (event-driven trades) ---------
    if (position.strategy === 'official_announcement') {
      if (ctx.officialPostDeleted) {
        return { fraction: 1, reason: 'official post deleted', emergency: true };
      }
      if (ctx.fakeContractWarning) {
        return { fraction: 1, reason: 'fake-contract warning detected', emergency: true };
      }
    }

    // ---- 4. Smart wallets selling (copy-trade) -------------------------
    if (position.strategy === 'smart_wallet_cluster') {
      const sells = ctx.eliteSellersInLastWindow ?? 0;
      if (sells >= 2) {
        return { fraction: 1, reason: `${sells} elite wallets selling`, emergency: true };
      }
      if (sells === 1) {
        return { fraction: 0.5, reason: '1 elite wallet selling — partial exit', emergency: false };
      }
    }

    // ---- 5. Buzz collapse (x-buzz) -------------------------------------
    if (position.strategy === 'x_buzz') {
      if (ctx.buzzScorePrior && ctx.buzzScoreNow !== undefined && ctx.buzzScorePrior > 60) {
        if (ctx.buzzScoreNow < ctx.buzzScorePrior * 0.5) {
          return { fraction: 1, reason: `buzz collapsed (${ctx.buzzScorePrior} -> ${ctx.buzzScoreNow})`, emergency: false };
        }
      }
    }

    // ---- 6. Profit ladder + trailing stop ------------------------------
    const pctGain = ((price - position.entryPriceUsd) / position.entryPriceUsd) * 100;
    if (price > position.highestPriceUsd) {
      position.highestPriceUsd = price;
      this.db.updateOpenPosition(position);
    }

    // Activate trailing once we hit any profit ladder rung.
    const ladder = this.cfg.profitLadder;
    for (const rung of ladder) {
      const already = position.partialExitsTaken.find((p) => p.atPct >= rung.pct - 1);
      if (!already && pctGain >= rung.pct) {
        return {
          fraction: rung.fraction,
          reason: `profit ladder +${rung.pct}% -> sell ${(rung.fraction * 100).toFixed(0)}%`,
          emergency: false,
        };
      }
    }

    // Trailing stop: drop from peak >= TRAILING_STOP_PERCENT after first rung hit.
    const anyPartial = position.partialExitsTaken.length > 0;
    if (anyPartial) {
      const dropPct = ((position.highestPriceUsd - price) / position.highestPriceUsd) * 100;
      if (dropPct >= this.cfg.TRAILING_STOP_PERCENT) {
        return {
          fraction: 1,
          reason: `trailing stop: -${dropPct.toFixed(1)}% from peak`,
          emergency: false,
        };
      }
    }

    // ---- 7. Time-based exit --------------------------------------------
    const heldMin = (now - position.entryTimestamp) / 60_000;
    if (heldMin >= this.cfg.TIME_BASED_EXIT_MINUTES) {
      return { fraction: 1, reason: `time-based: held ${heldMin.toFixed(0)} min`, emergency: false };
    }

    return null;
  }

  /** Side-effecting tick: applies the decision (paper or live) when needed. */
  async tick(position: OpenPosition, ctx: ExitContext): Promise<ExitDecision | null> {
    const decision = this.decide(position, ctx);
    if (!decision) return null;

    if (position.mode === 'paper') {
      await this.paper.exit(position, ctx.snapshot, decision.fraction, decision.reason, ctx.now);
    } else if (position.mode === 'live' && this.live) {
      await this.live.closePosition(position, ctx.snapshot, decision.fraction, decision.reason);
    }
    return decision;
  }
}
