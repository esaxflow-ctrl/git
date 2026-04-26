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

  let weighted = 0;
  weighted += breakdown.tokenSafety * WEIGHTS.tokenSafety;
  weighted += breakdown.smartWallet * WEIGHTS.smartWallet;
  weighted += breakdown.smartWalletCluster * WEIGHTS.smartWalletCluster;
  weighted += breakdown.buzz * WEIGHTS.buzz;
  weighted += breakdown.event * WEIGHTS.event;
  weighted += breakdown.pumpfun * WEIGHTS.pumpfun;
  weighted += breakdown.migration * WEIGHTS.migration;
  weighted += breakdown.liquidityGrowth * WEIGHTS.liquidityGrowth;
  weighted += breakdown.volumeAcceleration * WEIGHTS.volumeAcceleration;
  weighted += breakdown.dexscreenerBoost * WEIGHTS.dexscreenerBoost;
  weighted += breakdown.narrative * WEIGHTS.narrative;
  weighted += breakdown.jupiterExecutionQuality * WEIGHTS.jupiterExecutionQuality;

  // Too-late penalty (subtract up to 25 raw points if late).
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
    passingSupports.length >= 2
  ) {
    recommendation = 'LIVE_BUY_ALLOWED';
    reason = `master ${masterScore} >= LIVE_BUY_THRESHOLD ${cfg.LIVE_BUY_THRESHOLD} with ${passingSupports.length} confirmations`;
  } else if (masterScore >= cfg.LIVE_BUY_THRESHOLD - 10 && passingSupports.length >= 2) {
    recommendation = 'PAPER_BUY';
    reason = `master ${masterScore} good enough for paper; confirmations=${passingSupports.length}`;
  } else if (masterScore >= 60) {
    recommendation = 'WATCH';
    reason = `master ${masterScore} interesting but lacks confirmations (${passingSupports.length})`;
  } else {
    recommendation = 'PASS';
    reason = `master ${masterScore} below WATCH bar`;
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
