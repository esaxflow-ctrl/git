/**
 * X-buzz strategy. Wraps buzz score into a strategy signal but always
 * cross-checks: token safety, Jupiter route, liquidity, volume.
 *
 * Buzz alone NEVER gives LIVE_BUY_ALLOWED. Master signal can promote it if a
 * second independent confirmation joins (e.g. smart wallet, event, volume).
 */

import type { AppConfig } from '../config.js';
import type { BuzzResult } from '../scoring/buzzScore.js';
import type { StrategySignal, TokenSnapshot } from '../types.js';

export interface XBuzzInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  buzz: BuzzResult;
  /** Was the buzz acceleration window declining vs an earlier window? */
  buzzDecelerating: boolean;
}

export function xBuzzStrategy(i: XBuzzInputs): StrategySignal {
  const snap = i.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];

  let score = i.buzz.score;

  if (!snap.jupiterQuoteAvailable) {
    return {
      strategy: 'x_buzz',
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      score: 0,
      confirmations,
      warnings: ['no Jupiter route — buzz cannot be acted on'],
      recommendation: 'PASS',
      raw: { buzz: i.buzz },
    };
  }
  if (snap.liquidityUsd < i.cfg.MIN_TOKEN_LIQUIDITY_USD) {
    return {
      strategy: 'x_buzz',
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      score: Math.min(40, score),
      confirmations,
      warnings: [`liquidity $${snap.liquidityUsd.toFixed(0)} below minimum`],
      recommendation: 'WATCH',
      raw: { buzz: i.buzz },
    };
  }

  if (i.buzz.signalType === 'FAKE_CONTRACT_RISK') {
    return {
      strategy: 'x_buzz',
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      score: 10,
      confirmations,
      warnings: ['multiple distinct CAs — fake-contract risk'],
      recommendation: 'PASS',
      raw: { buzz: i.buzz },
    };
  }

  if (i.buzzDecelerating) {
    score -= 15;
    warnings.push('buzz velocity declining vs prior window');
  }

  if (i.buzz.breakdown.officialMentions > 0) {
    confirmations.push(`${i.buzz.breakdown.officialMentions} official-account mention(s)`);
  }
  if (i.buzz.breakdown.credibleMentions > 0) {
    confirmations.push(`${i.buzz.breakdown.credibleMentions} credible mention(s)`);
  }
  if (i.buzz.breakdown.spamShare > 0.3) warnings.push('high duplicate-spam ratio');
  if (i.buzz.breakdown.botShare > 0.4) warnings.push('high bot-account ratio');

  score = Math.max(0, Math.min(100, score));

  let rec: StrategySignal['recommendation'] = 'PASS';
  if (score >= 75) rec = 'PAPER_BUY';
  else if (score >= 55) rec = 'WATCH';

  return {
    strategy: 'x_buzz',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score,
    confirmations,
    warnings,
    recommendation: rec,
    raw: { buzz: i.buzz },
  };
}
