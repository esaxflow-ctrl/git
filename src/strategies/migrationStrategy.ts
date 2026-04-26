/**
 * Migration strategy. Looks for tokens that just migrated to a real DEX with:
 *   - real liquidity
 *   - working Jupiter route
 *   - post-migration volume acceleration
 *   - sane holder distribution
 *   - growing X buzz
 */

import type { AppConfig } from '../config.js';
import type { MigrationCandidate } from '../scanners/migrationScanner.js';
import type { StrategySignal } from '../types.js';

export interface MigrationInputs {
  cfg: AppConfig;
  candidate: MigrationCandidate;
  buzzScore: number;
  smartWalletEntries: number;
  /** Was the pre-migration phase organic (lots of unique buyers, not bot-driven)? */
  preMigrationOrganic: boolean;
  /** Has the post-migration market already gone vertical? */
  alreadyExhausted: boolean;
}

export function migrationStrategy(i: MigrationInputs): StrategySignal {
  const snap = i.candidate.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (snap.jupiterQuoteAvailable) {
    score += 15;
    confirmations.push('Jupiter route exists post-migration');
  } else {
    warnings.push('Jupiter route missing');
  }

  if (snap.liquidityUsd >= i.cfg.MIN_TOKEN_LIQUIDITY_USD * 2) {
    score += 15;
    confirmations.push(`liquidity $${snap.liquidityUsd.toFixed(0)}`);
  } else if (snap.liquidityUsd >= i.cfg.MIN_TOKEN_LIQUIDITY_USD) {
    score += 8;
  } else {
    warnings.push('low liquidity post-migration');
  }

  // Volume acceleration after migration.
  const ratio5To1h = snap.volume1hUsd > 0 ? snap.volume5mUsd / (snap.volume1hUsd / 12) : 0;
  if (ratio5To1h > 1.5) {
    score += 20;
    confirmations.push(`5m vol ${ratio5To1h.toFixed(2)}x trailing 5-min average`);
  } else if (ratio5To1h > 1) score += 10;

  if (i.preMigrationOrganic) {
    score += 10;
    confirmations.push('organic pre-migration activity');
  }

  if (i.smartWalletEntries >= 2) {
    score += 15;
    confirmations.push(`${i.smartWalletEntries} elite wallets entered post-migration`);
  } else if (i.smartWalletEntries === 1) score += 7;

  if (i.buzzScore >= i.cfg.BUZZ_SCORE_THRESHOLD) {
    score += 10;
    confirmations.push(`buzz ${i.buzzScore} >= ${i.cfg.BUZZ_SCORE_THRESHOLD}`);
  } else if (i.buzzScore >= 50) score += 5;

  // Holder concentration
  if (snap.top10HolderPct !== null) {
    if (snap.top10HolderPct <= 25) {
      score += 10;
      confirmations.push(`top-10 holders ${snap.top10HolderPct.toFixed(1)}%`);
    } else if (snap.top10HolderPct <= i.cfg.MAX_TOP_10_HOLDER_PERCENT) score += 4;
    else {
      score -= 10;
      warnings.push(`top-10 holders ${snap.top10HolderPct.toFixed(1)}% — concentrated`);
    }
  }

  if (i.alreadyExhausted) {
    score -= 30;
    warnings.push('post-migration market already vertical / exhausted');
  }

  score = Math.max(0, Math.min(100, score));

  let recommendation: StrategySignal['recommendation'] = 'PASS';
  if (score >= 80) recommendation = 'LIVE_BUY_ALLOWED';
  else if (score >= 70) recommendation = 'PAPER_BUY';
  else if (score >= 50) recommendation = 'WATCH';

  return {
    strategy: 'migration',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score,
    confirmations,
    warnings,
    recommendation,
    raw: {
      fromVenue: i.candidate.fromVenue,
      toVenue: i.candidate.toVenue,
      ratio5To1h,
    },
  };
}
