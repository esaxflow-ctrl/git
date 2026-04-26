/**
 * Pump.fun / bonding-curve strategy. Live launchpad trading is gated by
 * ENABLE_LIVE_LAUNCHPAD_TRADING (off by default).
 */

import type { AppConfig } from '../config.js';
import type { PumpfunCandidate } from '../scanners/pumpfunScanner.js';
import type { StrategySignal } from '../types.js';

export interface PumpfunInputs {
  cfg: AppConfig;
  candidate: PumpfunCandidate;
  smartWalletParticipation: number;        // count of elite wallets entering
  socialConfirmation: boolean;
  deployerHasRugHistory: boolean;
}

export function pumpfunStrategy(i: PumpfunInputs): StrategySignal {
  const { cfg, candidate } = i;
  const snap = candidate.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];

  let score = 0;
  // Buyer growth (0..25)
  if (candidate.estUniqueBuyers >= 75) score += 25;
  else if (candidate.estUniqueBuyers >= 30) score += 15;
  else if (candidate.estUniqueBuyers >= 15) score += 8;
  else warnings.push(`only ${candidate.estUniqueBuyers} unique buyers`);

  // Volume (0..15)
  if (snap.volume5mUsd >= cfg.MIN_VOLUME_5M_USD * 2) score += 15;
  else if (snap.volume5mUsd >= cfg.MIN_VOLUME_5M_USD) score += 8;

  // Smart-wallet participation (0..20)
  if (i.smartWalletParticipation >= 2) {
    score += 20;
    confirmations.push(`${i.smartWalletParticipation} elite wallets in launchpad`);
  } else if (i.smartWalletParticipation === 1) score += 10;

  // Social confirmation (0..10)
  if (i.socialConfirmation) {
    score += 10;
    confirmations.push('organic social confirmation');
  }

  // Holder concentration (0..15)
  if (
    candidate.earlyHolderConcentrationPct !== null &&
    candidate.earlyHolderConcentrationPct < 25
  ) {
    score += 15;
    confirmations.push(`top-10 holders ${candidate.earlyHolderConcentrationPct.toFixed(1)}%`);
  } else if (
    candidate.earlyHolderConcentrationPct !== null &&
    candidate.earlyHolderConcentrationPct < 40
  ) {
    score += 5;
  } else if (candidate.earlyHolderConcentrationPct !== null) {
    score -= 10;
    warnings.push(`top-10 holders ${candidate.earlyHolderConcentrationPct.toFixed(1)}% — concentrated`);
  }

  if (i.deployerHasRugHistory) {
    score -= 50;
    warnings.push('deployer has prior rug history');
  }

  score = Math.max(0, Math.min(100, score));

  // Live trading on launchpad requires the explicit secondary flag AND live mode.
  const liveAllowed = cfg.liveModeEnabled && cfg.ENABLE_LIVE_LAUNCHPAD_TRADING;
  let recommendation: StrategySignal['recommendation'] = 'PASS';
  if (score >= 75 && liveAllowed) recommendation = 'LIVE_BUY_ALLOWED';
  else if (score >= 65) recommendation = 'PAPER_BUY';
  else if (score >= 45) recommendation = 'WATCH';

  return {
    strategy: 'pumpfun_bonding_curve',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score,
    confirmations,
    warnings,
    recommendation,
    raw: {
      curveProgressPct: candidate.curveProgressPct,
      uniqueBuyers: candidate.estUniqueBuyers,
      holderConcentration: candidate.earlyHolderConcentrationPct,
    },
  };
}
