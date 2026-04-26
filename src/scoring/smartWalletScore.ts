/**
 * Smart-wallet score (0–100) based on realised PnL, win rate, expectancy,
 * profit factor, and various penalties for insider / sniper / dev behaviours.
 *
 * Pure function over a WalletScoreBreakdown.
 */

import type { WalletLabel, WalletScoreBreakdown } from '../types.js';

export interface SmartWalletScoreResult {
  score: number;
  label: WalletLabel;
  reasons: string[];
}

export function scoreSmartWallet(b: WalletScoreBreakdown, fundedByDeployer = false, deployerLikely = false): SmartWalletScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // Win rate component (0..30)
  if (b.winRate >= 0.6) {
    score += 30;
    reasons.push(`high win rate ${(b.winRate * 100).toFixed(0)}%`);
  } else if (b.winRate >= 0.5) {
    score += 20;
  } else if (b.winRate >= 0.4) {
    score += 10;
  }

  // Profit factor component (0..25)
  if (b.profitFactor >= 3) {
    score += 25;
    reasons.push(`profit factor ${b.profitFactor.toFixed(2)}`);
  } else if (b.profitFactor >= 2) {
    score += 18;
  } else if (b.profitFactor >= 1.5) {
    score += 10;
  }

  // Expectancy component (0..15)
  if (b.expectancy > 0.2) {
    score += 15;
    reasons.push(`positive expectancy ${b.expectancy.toFixed(2)}`);
  } else if (b.expectancy > 0.05) {
    score += 8;
  }

  // Repeatability + copyability (0..15)
  score += Math.round(b.repeatabilityScore * 0.075);
  score += Math.round(b.copyabilityScore * 0.075);

  // Realised PnL bias (0..10)
  if (b.realisedPnl30d > 0 && b.realisedPnl90d > 0) {
    score += 10;
    reasons.push(`positive realised PnL 30d & 90d`);
  } else if (b.realisedPnl30d > 0) {
    score += 5;
  }

  // Hold time (0..5) — middle band rewarded; flash-flippers and bag-holders punished.
  if (b.avgHoldMinutes >= 30 && b.avgHoldMinutes <= 720) score += 5;

  // ---- Penalties -----------------------------------------------------------
  if (b.trades < 10) {
    score -= 30;
    reasons.push(`only ${b.trades} trades — sample too small`);
  } else if (b.trades < 25) {
    score -= 10;
  }

  if (fundedByDeployer || deployerLikely) {
    score -= 50;
    reasons.push('wallet funded by/related to deployer chain');
  }

  if (b.suspiciousBehaviourScore > 50) {
    score -= 25;
    reasons.push(`suspicious behaviour score ${b.suspiciousBehaviourScore}`);
  }

  if (b.rugExposure > 30) {
    score -= 15;
    reasons.push(`rug exposure ${b.rugExposure}%`);
  }

  if (b.maxDrawdown > 0.7) {
    score -= 10;
    reasons.push(`max drawdown ${(b.maxDrawdown * 100).toFixed(0)}%`);
  }

  if (b.avgHoldMinutes < 1) {
    score -= 25;
    reasons.push('average hold < 1 min — likely sniper bot');
  }

  // Single-win wallets (1–3 trades carrying everything)
  if (b.trades >= 5 && b.winRate >= 0.4 && b.profitFactor > 5 && b.expectancy < 0.05) {
    score -= 15;
    reasons.push('PnL concentrated in 1–3 trades — not repeatable');
  }

  score = Math.max(0, Math.min(100, score));

  // Labels
  let label: WalletLabel = 'IGNORE';
  if (deployerLikely) label = 'DEV_WALLET_LIKELY';
  else if (fundedByDeployer || b.suspiciousBehaviourScore > 60) label = 'INSIDER_LIKELY';
  else if (b.avgHoldMinutes < 1) label = 'SNIPER_BOT';
  else if (score >= 80) label = 'ELITE_COPYABLE';
  else if (score >= 65) label = 'GOOD_BUT_RISKY';
  else if (b.copyabilityScore < 30) label = 'TOO_FAST_TO_COPY';
  else if (score < 35) label = 'LOW_QUALITY';

  return { score, label, reasons };
}
