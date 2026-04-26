/**
 * Volume-acceleration strategy. Look for volume rising faster than price
 * (suggesting fresh demand, not late-FOMO). Reject obvious wash patterns.
 */

import type { AppConfig } from '../config.js';
import type { StrategySignal, TokenSnapshot } from '../types.js';

export interface VolumeAccelerationInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
}

export function volumeAccelerationStrategy(i: VolumeAccelerationInputs): StrategySignal {
  const snap = i.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // 5-min volume vs implied 5-min average from 1h.
  const impliedAvg5m = snap.volume1hUsd / 12;
  const ratio = impliedAvg5m > 0 ? snap.volume5mUsd / impliedAvg5m : 0;

  if (ratio >= 3) {
    score += 25;
    confirmations.push(`5m volume ${ratio.toFixed(2)}x trailing 5m`);
  } else if (ratio >= 2) score += 18;
  else if (ratio >= 1.5) score += 10;

  // Buy/sell ratio in 5m.
  const total = snap.buyCount5m + snap.sellCount5m;
  if (total >= 30) {
    const buyRatio = snap.buyCount5m / total;
    if (buyRatio >= 0.65) {
      score += 15;
      confirmations.push(`buy ratio ${(buyRatio * 100).toFixed(0)}%`);
    } else if (buyRatio < 0.4) {
      score -= 10;
      warnings.push(`sell-heavy (${(buyRatio * 100).toFixed(0)}% buys)`);
    }
  }

  // Unique buyers acceleration proxy (we don't have history here; use absolute).
  if (snap.uniqueBuyers5m >= i.cfg.MIN_UNIQUE_BUYERS_5M * 3) {
    score += 15;
    confirmations.push(`${snap.uniqueBuyers5m} unique buyers — broad participation`);
  } else if (snap.uniqueBuyers5m >= i.cfg.MIN_UNIQUE_BUYERS_5M * 2) score += 8;

  // Wash-pattern penalty: tons of volume but tiny unique-buyer count.
  if (snap.volume5mUsd > i.cfg.MIN_VOLUME_5M_USD * 3 && snap.uniqueBuyers5m < i.cfg.MIN_UNIQUE_BUYERS_5M) {
    score -= 25;
    warnings.push('high volume / few unique buyers — wash pattern suspected');
  }

  // Already-vertical penalty.
  if (snap.priceChange5mPct > 50) {
    score -= 15;
    warnings.push(`price +${snap.priceChange5mPct.toFixed(0)}% in 5m — vertical`);
  } else if (snap.priceChange5mPct > 25) {
    score -= 5;
  }

  // Volume rising faster than price = fresh demand (positive).
  if (ratio >= 2 && snap.priceChange5mPct < 30) {
    score += 15;
    confirmations.push('volume up, price not yet vertical');
  }

  score = Math.max(0, Math.min(100, score));

  let rec: StrategySignal['recommendation'] = 'PASS';
  if (score >= 75) rec = 'PAPER_BUY';
  else if (score >= 55) rec = 'WATCH';

  return {
    strategy: 'volume_acceleration',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score,
    confirmations,
    warnings,
    recommendation: rec,
    raw: { ratio, priceChange5m: snap.priceChange5mPct },
  };
}

/** Also returns 0–100 directly for use in master scoring. */
export function volumeAccelerationScore(cfg: AppConfig, snap: TokenSnapshot): number {
  return volumeAccelerationStrategy({ cfg, snapshot: snap }).score;
}
