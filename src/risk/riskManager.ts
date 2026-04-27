/**
 * Risk manager: the last gate before any trade.
 *
 * Every check returns a structured Approval result. Approvals are *fail-closed*:
 * if any input is missing/null/uncertain, the manager refuses by default.
 *
 * Rules enforced:
 *   - kill switch
 *   - LIVE_TRADING + PAPER_TRADING flags
 *   - master score thresholds
 *   - safety score thresholds
 *   - liquidity / volume / unique buyers / price impact / slippage minima
 *   - max open positions, max daily loss, consecutive-loss cooldown
 *   - safety reserve balance
 *   - quote freshness
 *   - holder concentration
 *   - too-late penalty
 */

import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import type {
  JupiterQuoteResult,
  MasterSignal,
  RiskEvent,
  TokenSnapshot,
} from '../types.js';
import type { KillSwitch } from './killSwitch.js';

export interface RiskInputs {
  signal: MasterSignal;
  snapshot: TokenSnapshot;
  quote: JupiterQuoteResult | null;
  walletBalanceSol: number;
  intendedMode: 'paper' | 'live';
  now: number;
}

export interface RiskApproval {
  approved: boolean;
  reasons: string[];        // why it passed (if approved) or why it failed (if not)
  recommendedMode: 'paper' | 'live' | 'none';
  riskEvents: RiskEvent[];  // any side-effect events to record
}

const QUOTE_FRESHNESS_MS = 10_000;

export class RiskManager {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: Db,
    private readonly killSwitch: KillSwitch,
  ) {}

  approve(input: RiskInputs): RiskApproval {
    const reasons: string[] = [];
    const events: RiskEvent[] = [];
    const fail = (r: string, ev?: RiskEvent): RiskApproval => {
      if (ev) events.push(ev);
      return {
        approved: false,
        reasons: [r, ...reasons],
        recommendedMode: 'none',
        riskEvents: events,
      };
    };

    const { signal, snapshot, quote, walletBalanceSol, intendedMode, now } = input;

    // ----- 1. Kill switch -------------------------------------------------
    if (this.killSwitch.isEngaged()) {
      return fail(`kill switch engaged (${this.killSwitch.filePath()} present)`, {
        kind: 'kill_switch_engaged',
        timestamp: now,
        detail: this.killSwitch.filePath(),
      });
    }

    // ----- 2. Mode flags --------------------------------------------------
    if (intendedMode === 'live' && !this.cfg.liveModeEnabled) {
      return fail(
        'live mode requested but disabled (need LIVE_TRADING=true and PAPER_TRADING=false)',
        { kind: 'live_disabled', timestamp: now, detail: 'liveModeEnabled=false' },
      );
    }

    // ----- 3. Score thresholds -------------------------------------------
    if (signal.breakdown.tokenSafety < this.cfg.TOKEN_SAFETY_THRESHOLD) {
      return fail(
        `safety score ${signal.breakdown.tokenSafety} < threshold ${this.cfg.TOKEN_SAFETY_THRESHOLD}`,
      );
    }

    if (intendedMode === 'live' && signal.masterScore < this.cfg.LIVE_BUY_THRESHOLD) {
      return fail(
        `master score ${signal.masterScore.toFixed(1)} < LIVE_BUY_THRESHOLD ${this.cfg.LIVE_BUY_THRESHOLD}`,
      );
    }

    // ----- 4. Liquidity / volume / unique buyers --------------------------
    if (snapshot.liquidityUsd < this.cfg.MIN_TOKEN_LIQUIDITY_USD) {
      return fail(
        `liquidity $${snapshot.liquidityUsd.toFixed(0)} < MIN_TOKEN_LIQUIDITY_USD $${this.cfg.MIN_TOKEN_LIQUIDITY_USD}`,
      );
    }
    if (snapshot.volume5mUsd < this.cfg.MIN_VOLUME_5M_USD) {
      return fail(
        `5m volume $${snapshot.volume5mUsd.toFixed(0)} < MIN_VOLUME_5M_USD $${this.cfg.MIN_VOLUME_5M_USD}`,
      );
    }
    if (snapshot.volume1hUsd < this.cfg.MIN_VOLUME_1H_USD) {
      return fail(
        `1h volume $${snapshot.volume1hUsd.toFixed(0)} < MIN_VOLUME_1H_USD $${this.cfg.MIN_VOLUME_1H_USD}`,
      );
    }
    if (snapshot.uniqueBuyers5m < this.cfg.MIN_UNIQUE_BUYERS_5M) {
      return fail(
        `unique buyers 5m ${snapshot.uniqueBuyers5m} < MIN_UNIQUE_BUYERS_5M ${this.cfg.MIN_UNIQUE_BUYERS_5M}`,
      );
    }

    // ----- 5. Holder concentration ---------------------------------------
    if (
      snapshot.top10HolderPct !== null &&
      snapshot.top10HolderPct > this.cfg.MAX_TOP_10_HOLDER_PERCENT
    ) {
      return fail(
        `top-10 holders ${snapshot.top10HolderPct.toFixed(1)}% > MAX_TOP_10_HOLDER_PERCENT ${this.cfg.MAX_TOP_10_HOLDER_PERCENT}%`,
      );
    }
    if (
      snapshot.topSingleHolderPct !== null &&
      snapshot.topSingleHolderPct > this.cfg.MAX_SINGLE_HOLDER_PERCENT
    ) {
      return fail(
        `top single holder ${snapshot.topSingleHolderPct.toFixed(1)}% > MAX_SINGLE_HOLDER_PERCENT ${this.cfg.MAX_SINGLE_HOLDER_PERCENT}%`,
      );
    }

    // ----- 6. Quote / impact / slippage ----------------------------------
    if (intendedMode === 'live') {
      if (!quote) {
        return fail('no Jupiter quote available', {
          kind: 'quote_failure',
          timestamp: now,
          detail: signal.token.address,
        });
      }
      if (now - quote.fetchedAt > QUOTE_FRESHNESS_MS) {
        return fail(`stale quote (age ${(now - quote.fetchedAt) / 1000}s > 10s)`, {
          kind: 'quote_failure',
          timestamp: now,
          detail: 'stale',
        });
      }
      if (quote.priceImpactPct > this.cfg.MAX_PRICE_IMPACT_PERCENT) {
        return fail(
          `price impact ${quote.priceImpactPct.toFixed(2)}% > MAX_PRICE_IMPACT_PERCENT ${this.cfg.MAX_PRICE_IMPACT_PERCENT}%`,
          { kind: 'price_impact_exceeded', timestamp: now, detail: `${quote.priceImpactPct}%` },
        );
      }
      if (quote.slippageBps > this.cfg.MAX_SLIPPAGE_BPS) {
        return fail(
          `slippage ${quote.slippageBps}bps > MAX_SLIPPAGE_BPS ${this.cfg.MAX_SLIPPAGE_BPS}bps`,
          { kind: 'slippage_exceeded', timestamp: now, detail: `${quote.slippageBps}bps` },
        );
      }
    } else {
      // Paper still respects the same caps using the snapshot estimates.
      if (
        snapshot.estPriceImpactPct !== null &&
        snapshot.estPriceImpactPct > this.cfg.MAX_PRICE_IMPACT_PERCENT
      ) {
        return fail(
          `estimated price impact ${snapshot.estPriceImpactPct.toFixed(2)}% > MAX_PRICE_IMPACT_PERCENT`,
        );
      }
    }

    // ----- 7. Open-position limit ----------------------------------------
    const open = this.db.listOpenPositions(intendedMode).length;
    if (open >= this.cfg.MAX_OPEN_POSITIONS) {
      return fail(`open positions ${open} >= MAX_OPEN_POSITIONS ${this.cfg.MAX_OPEN_POSITIONS}`, {
        kind: 'max_open_positions',
        timestamp: now,
        detail: `${open}`,
      });
    }

    // ----- 8. Daily-loss limit -------------------------------------------
    const dayStart = startOfUtcDay(now);
    const pnlToday = this.db.realisedPnlSolSince(dayStart, intendedMode);
    if (pnlToday < 0 && Math.abs(pnlToday) >= this.cfg.MAX_DAILY_LOSS_SOL) {
      return fail(
        `daily loss ${pnlToday.toFixed(4)} SOL >= MAX_DAILY_LOSS_SOL ${this.cfg.MAX_DAILY_LOSS_SOL}`,
        { kind: 'daily_loss_limit', timestamp: now, detail: pnlToday.toFixed(4) },
      );
    }

    // ----- 9. Consecutive-loss cooldown ----------------------------------
    const losses = this.db.consecutiveLosses(intendedMode);
    if (losses >= this.cfg.MAX_CONSECUTIVE_LOSSES) {
      const lastLoss = this.db.lastLossTimestamp(intendedMode);
      const cooldownEnds = (lastLoss ?? now) + this.cfg.COOLDOWN_AFTER_LOSS_MINUTES * 60_000;
      if (now < cooldownEnds) {
        const remaining = Math.ceil((cooldownEnds - now) / 60_000);
        return fail(
          `${losses} consecutive losses; cooldown ~${remaining} min remaining`,
          { kind: 'consecutive_loss_cooldown', timestamp: now, detail: `${losses}` },
        );
      }
    }

    // ----- 10. Safety reserve --------------------------------------------
    if (intendedMode === 'live') {
      const required = this.cfg.SAFETY_RESERVE_SOL + this.cfg.MAX_TRADE_SOL;
      if (walletBalanceSol < required) {
        return fail(
          `wallet balance ${walletBalanceSol.toFixed(4)} SOL < required ${required.toFixed(4)} (reserve + max trade)`,
          { kind: 'wallet_below_reserve', timestamp: now, detail: walletBalanceSol.toFixed(4) },
        );
      }
    }

    // ----- 11. Too-late penalty ------------------------------------------
    if (signal.breakdown.tooLatePenalty > 60) {
      return fail(`too-late score ${signal.breakdown.tooLatePenalty} > 60`);
    }

    // ----- 12. Recommendation must allow trading ------------------------
    if (signal.recommendation === 'PASS' || signal.recommendation === 'EMERGENCY_EXIT') {
      return fail(`signal recommendation is ${signal.recommendation}`);
    }
    if (intendedMode === 'live' && signal.recommendation !== 'LIVE_BUY_ALLOWED') {
      return fail(`live requested but signal recommendation = ${signal.recommendation}`);
    }
    if (
      intendedMode === 'paper' &&
      signal.recommendation !== 'PAPER_BUY' &&
      signal.recommendation !== 'LIVE_BUY_ALLOWED'
    ) {
      return fail(`paper requested but signal recommendation = ${signal.recommendation}`);
    }

    reasons.push(
      `kill switch off, mode=${intendedMode}, master=${signal.masterScore.toFixed(1)}, ` +
        `safety=${signal.breakdown.tokenSafety}, liq=$${snapshot.liquidityUsd.toFixed(0)}, ` +
        `vol5m=$${snapshot.volume5mUsd.toFixed(0)}, open=${open}, pnlToday=${pnlToday.toFixed(4)} SOL`,
    );

    return { approved: true, reasons, recommendedMode: intendedMode, riskEvents: events };
  }
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
