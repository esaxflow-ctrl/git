/**
 * Too-late rejection model.
 *
 * Returns a 0–100 penalty (higher = more late). The risk manager rejects any
 * signal with penalty > 60. The master scorer also subtracts proportionally.
 *
 * Reasons we treat as "too late":
 *   - vertical move with no consolidation
 *   - market cap expanded too quickly
 *   - 5m volume already declining vs 15m / 1h average
 *   - smart wallets selling
 *   - retail-influencer posts arriving after the pump
 */

import type { TokenSnapshot } from '../types.js';

export interface TooLateInputs {
  snap: TokenSnapshot;
  /** Buzz score in the most-recent window. */
  buzzScoreNow: number;
  /** Buzz score in the prior window of equal size. */
  buzzScorePrior: number;
  /** Count of elite wallets selling in the last hour. */
  eliteSellersLastHour: number;
  /** Hours since FDV doubled, if known. */
  hoursSinceMcDoubled: number | null;
}

export interface TooLateResult {
  penalty: number;
  reasons: string[];
}

export function scoreTooLate(i: TooLateInputs): TooLateResult {
  const reasons: string[] = [];
  let penalty = 0;

  // Vertical price.
  if (i.snap.priceChange5mPct >= 80) {
    penalty += 30;
    reasons.push(`5m price +${i.snap.priceChange5mPct.toFixed(0)}% — vertical`);
  } else if (i.snap.priceChange5mPct >= 50) {
    penalty += 20;
  } else if (i.snap.priceChange5mPct >= 25) {
    penalty += 10;
  }

  // Volume already declining.
  const impliedAvg5m = i.snap.volume1hUsd / 12;
  if (impliedAvg5m > 0 && i.snap.volume5mUsd < impliedAvg5m * 0.6) {
    penalty += 15;
    reasons.push(`5m volume below trailing average — momentum fading`);
  }

  // Buzz peaked and declining.
  if (i.buzzScorePrior > 60 && i.buzzScoreNow < i.buzzScorePrior * 0.7) {
    penalty += 15;
    reasons.push(`buzz declining (${i.buzzScorePrior} -> ${i.buzzScoreNow})`);
  }

  // Smart wallets selling.
  if (i.eliteSellersLastHour >= 2) {
    penalty += 20;
    reasons.push(`${i.eliteSellersLastHour} elite wallets selling in last hour`);
  } else if (i.eliteSellersLastHour === 1) {
    penalty += 8;
  }

  // FDV expanded too quickly.
  if (i.hoursSinceMcDoubled !== null && i.hoursSinceMcDoubled < 0.5) {
    penalty += 10;
    reasons.push('market cap doubled in <30 min — likely too late');
  }

  // 1h move already very large. Tightened: a token up 100%+ in an hour is
  // almost always already past the move, regardless of other signals.
  if (i.snap.priceChange1hPct >= 300) {
    penalty += 40;
    reasons.push(`1h price +${i.snap.priceChange1hPct.toFixed(0)}% — likely terminal`);
  } else if (i.snap.priceChange1hPct >= 150) {
    penalty += 25;
    reasons.push(`1h price +${i.snap.priceChange1hPct.toFixed(0)}%`);
  } else if (i.snap.priceChange1hPct >= 100) {
    penalty += 15;
    reasons.push(`1h price +${i.snap.priceChange1hPct.toFixed(0)}% — exhaustion risk`);
  } else if (i.snap.priceChange1hPct >= 50) {
    penalty += 5;
  }

  penalty = Math.max(0, Math.min(100, Math.round(penalty)));
  return { penalty, reasons };
}
