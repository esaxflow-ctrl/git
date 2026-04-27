/**
 * Master signal score: combines all sub-scores into a single 0–100 number plus
 * a Recommendation.
 *
 * Hard rules (mirrored in RiskManager so a misconfigured strategy can't bypass):
 *   - tokenSafety < threshold              -> PASS
 *   - !riskManagerApproved                 -> PASS
 *   - tooLatePenalty > 60                  -> PASS / WATCH
 *   - LIVE_BUY_ALLOWED requires *all* of:
 *       cfg.liveModeEnabled
 *       masterScore >= LIVE_BUY_THRESHOLD
 *       tokenSafety >= TOKEN_SAFETY_THRESHOLD
 *       at least 2 independent supporting signals (smart wallet, buzz, event,
 *         migration, liquidity growth, volume, narrative)
 */

import type { AppConfig } from '../config.js';
import type {
  MasterSignal,
  Recommendation,
  ScoreBreakdown,
  StrategySource,
  TokenIdentity,
} from '../types.js';

export interface MasterScoreInputs {
  cfg: AppConfig;
  token: TokenIdentity;
  strategy: StrategySource;
  breakdown: ScoreBreakdown;
  /** Strategy-supplied confirmations and risks. */
  confirmations: string[];
  risks: string[];
}

const WEIGHTS = {
  tokenSafety: 0.18,
  smartWallet: 0.10,
  smartWalletCluster: 0.07,
  buzz: 0.08,
  event: 0.10,
  pumpfun: 0.05,
  migration: 0.05,
  liquidityGrowth: 0.07,
  volumeAcceleration: 0.10,
  dexscreenerBoost: 0.03,
  narrative: 0.04,
  jupiterExecutionQuality: 0.08,
  // tooLatePenalty subtracts up to 5 weighted points
};

export function computeMasterSignal(input: MasterScoreInputs): MasterSignal {
  const { cfg, breakdown } = input;

  // Each sub-score is "active" when it has actually been measured. A score of
  // 0 means the upstream module didn't run (or returned no signal), not that
  // the token failed that gate. Treating 0 as a real measurement of "bad"
  // crushed the master score whenever only a handful of modules were wired
  // up — see Solana paper-mode runs where MAGA / LOL / Dunald passed every
  // hard gate but got recommendation = PASS purely because 8 of 12 sub-scores
  // were unfilled.
  //
  // Fix: weighted average over active components only. A token with strong
  // signals from a few sources still scores well. The recommendation logic
  // separately requires a minimum number of active components to act, so
  // sparse data can't trigger LIVE_BUY_ALLOWED.

  const components: Array<{ name: string; score: number; weight: number }> = [
    { name: 'tokenSafety', score: breakdown.tokenSafety, weight: WEIGHTS.tokenSafety },
    { name: 'smartWallet', score: breakdown.smartWallet, weight: WEIGHTS.smartWallet },
    { name: 'smartWalletCluster', score: breakdown.smartWalletCluster, weight: WEIGHTS.smartWalletCluster },
    { name: 'buzz', score: breakdown.buzz, weight: WEIGHTS.buzz },
    { name: 'event', score: breakdown.event, weight: WEIGHTS.event },
    { name: 'pumpfun', score: breakdown.pumpfun, weight: WEIGHTS.pumpfun },
    { name: 'migration', score: breakdown.migration, weight: WEIGHTS.migration },
    { name: 'liquidityGrowth', score: breakdown.liquidityGrowth, weight: WEIGHTS.liquidityGrowth },
    { name: 'volumeAcceleration', score: breakdown.volumeAcceleration, weight: WEIGHTS.volumeAcceleration },
    { name: 'dexscreenerBoost', score: breakdown.dexscreenerBoost, weight: WEIGHTS.dexscreenerBoost },
    { name: 'narrative', score: breakdown.narrative, weight: WEIGHTS.narrative },
    { name: 'jupiterExecutionQuality', score: breakdown.jupiterExecutionQuality, weight: WEIGHTS.jupiterExecutionQuality },
  ];

  const active = components.filter((c) => c.score > 0);
  const totalActiveWeight = active.reduce((s, c) => s + c.weight, 0);
  const weightedSum = active.reduce((s, c) => s + c.score * c.weight, 0);
  let weighted = totalActiveWeight > 0 ? weightedSum / totalActiveWeight : 0;

  // Too-late penalty applies in absolute terms (subtract up to 25 points).
  const latePenalty = (Math.max(0, breakdown.tooLatePenalty) / 100) * 25;
  weighted -= latePenalty;

  const masterScore = Math.max(0, Math.min(100, Math.round(weighted)));

  // ---- Independent confirmations count ------------------------------------
  // For LIVE_BUY_ALLOWED we want >= 2 independent supporting signals beyond safety.
  const supports: { name: string; score: number; threshold: number }[] = [
    { name: 'smart wallet', score: breakdown.smartWallet, threshold: cfg.SMART_WALLET_MIN_SCORE },
    { name: 'smart wallet cluster', score: breakdown.smartWalletCluster, threshold: 60 },
    { name: 'buzz', score: breakdown.buzz, threshold: cfg.BUZZ_SCORE_THRESHOLD },
    { name: 'event', score: breakdown.event, threshold: cfg.EVENT_SCORE_THRESHOLD },
    { name: 'pumpfun', score: breakdown.pumpfun, threshold: 65 },
    { name: 'migration', score: breakdown.migration, threshold: 65 },
    { name: 'liquidity growth', score: breakdown.liquidityGrowth, threshold: 65 },
    { name: 'volume acceleration', score: breakdown.volumeAcceleration, threshold: 65 },
    { name: 'narrative', score: breakdown.narrative, threshold: cfg.NARRATIVE_SCORE_THRESHOLD },
  ];
  const passingSupports = supports.filter((s) => s.score >= s.threshold);
  const strongestConfirmations = [
    ...input.confirmations,
    ...passingSupports.map((s) => `${s.name} score ${s.score} >= ${s.threshold}`),
  ];

  // ---- Recommendation -----------------------------------------------------
  let recommendation: Recommendation = 'PASS';
  let reason = '';

  if (breakdown.tokenSafety < cfg.TOKEN_SAFETY_THRESHOLD) {
    recommendation = 'PASS';
    reason = `safety ${breakdown.tokenSafety} < ${cfg.TOKEN_SAFETY_THRESHOLD}`;
  } else if (breakdown.tooLatePenalty > 60) {
    recommendation = breakdown.tooLatePenalty > 80 ? 'PASS' : 'WATCH';
    reason = `too-late penalty ${breakdown.tooLatePenalty}`;
  } else if (!breakdown.riskManagerApproved) {
    recommendation = 'PASS';
    reason = 'risk manager pre-check failed';
  } else if (
    cfg.liveModeEnabled &&
    masterScore >= cfg.LIVE_BUY_THRESHOLD &&
    passingSupports.length >= 2 &&
    active.length >= 4
  ) {
    // Live still requires 2+ independent supports AND >= 4 active components.
    // The active.length gate keeps live trading honest even with the
    // normalised score: a single very-strong sub-score can't trigger live.
    recommendation = 'LIVE_BUY_ALLOWED';
    reason = `master ${masterScore} >= LIVE_BUY_THRESHOLD ${cfg.LIVE_BUY_THRESHOLD}, ${passingSupports.length} confirmations, ${active.length} active components`;
  } else if (masterScore >= cfg.LIVE_BUY_THRESHOLD - 10 && passingSupports.length >= 1) {
    // Paper-buy is more permissive: 1 supporting signal is enough provided
    // the master score still clears LIVE_BUY_THRESHOLD - 10.
    recommendation = 'PAPER_BUY';
    reason = `master ${masterScore} good enough for paper; confirmations=${passingSupports.length}, active=${active.length}`;
  } else if (masterScore >= 60 || passingSupports.length >= 1) {
    recommendation = 'WATCH';
    reason = `master ${masterScore}, ${passingSupports.length} confirmations, ${active.length} active`;
  } else {
    recommendation = 'PASS';
    reason = `master ${masterScore} below WATCH bar (${active.length} active components)`;
  }

  return {
    token: input.token,
    strategy: input.strategy,
    masterScore,
    breakdown,
    strongestConfirmations,
    biggestRisks: input.risks,
    recommendation,
    generatedAt: Date.now(),
    reason,
  };
}

export function emptyBreakdown(): ScoreBreakdown {
  return {
    tokenSafety: 0,
    smartWallet: 0,
    smartWalletCluster: 0,
    buzz: 0,
    event: 0,
    pumpfun: 0,
    migration: 0,
    liquidityGrowth: 0,
    volumeAcceleration: 0,
    dexscreenerBoost: 0,
    narrative: 0,
    jupiterExecutionQuality: 0,
    tooLatePenalty: 0,
    riskManagerApproved: false,
  };
}
