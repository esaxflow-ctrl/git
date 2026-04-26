/**
 * Liquidity-growth strategy. Strong signal when liquidity is rising while
 * volume rises, unique buyers rise, and price impact is improving.
 *
 * Also acts as the *emergency exit* trigger when liquidity drains.
 */

import type { AppConfig } from '../config.js';
import type { LiquidityDelta } from '../scanners/liquidityScanner.js';
import type { StrategySignal, TokenSnapshot } from '../types.js';

export interface LiquidityGrowthInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  delta: LiquidityDelta | null;
  smartWalletEntries: number;
}

export function liquidityGrowthStrategy(i: LiquidityGrowthInputs): StrategySignal {
  const snap = i.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (i.delta?.kind === 'drained') {
    return {
      strategy: 'liquidity_growth',
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      score: 0,
      confirmations: [],
      warnings: [`liquidity drained ${i.delta.deltaPct.toFixed(1)}% in ${i.delta.withinSeconds.toFixed(0)}s`],
      recommendation: 'EMERGENCY_EXIT',
      raw: { delta: i.delta },
    };
  }

  if (i.delta?.kind === 'added') {
    score += 25;
    confirmations.push(`liquidity +${i.delta.deltaPct.toFixed(1)}%`);
  }

  if (snap.volume5mUsd > i.cfg.MIN_VOLUME_5M_USD * 2) {
    score += 15;
    confirmations.push(`5m volume strong`);
  }

  if (snap.uniqueBuyers5m >= i.cfg.MIN_UNIQUE_BUYERS_5M * 2) {
    score += 15;
    confirmations.push(`${snap.uniqueBuyers5m} unique buyers (>=2x min)`);
  }

  if (snap.estPriceImpactPct !== null && snap.estPriceImpactPct < i.cfg.MAX_PRICE_IMPACT_PERCENT / 2) {
    score += 10;
    confirmations.push(`price impact ${snap.estPriceImpactPct.toFixed(2)}%`);
  }

  if (i.smartWalletEntries >= 1) {
    score += 15;
    confirmations.push(`${i.smartWalletEntries} elite wallet entries`);
  }

  if (i.delta?.kind === 'removed') {
    score -= 25;
    warnings.push(`liquidity ${i.delta.deltaPct.toFixed(1)}%`);
  }

  score = Math.max(0, Math.min(100, score));

  let rec: StrategySignal['recommendation'] = 'PASS';
  if (score >= 70) rec = 'PAPER_BUY';
  else if (score >= 50) rec = 'WATCH';

  return {
    strategy: 'liquidity_growth',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score,
    confirmations,
    warnings,
    recommendation: rec,
    raw: { delta: i.delta },
  };
}
