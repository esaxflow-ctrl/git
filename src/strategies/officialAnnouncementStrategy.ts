/**
 * Official announcement strategy: high-credibility source posts a CA that
 * is also confirmed on-chain (DexScreener + Birdeye + Jupiter). Verified
 * launches allow tiny live buys with aggressive exits.
 */

import type { AppConfig } from '../config.js';
import type { EventResult } from '../scoring/eventScore.js';
import type { StrategySignal, TokenSnapshot } from '../types.js';

export interface OfficialInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  event: EventResult;
}

export function officialAnnouncementStrategy(i: OfficialInputs): StrategySignal {
  const snap = i.snapshot;
  const confirmations: string[] = [];
  const warnings: string[] = [];

  if (i.event.signalType === 'FAKE_LAUNCH_RISK' || i.event.signalType === 'TOO_LATE_PASS') {
    return {
      strategy: 'official_announcement',
      token: { address: snap.address, symbol: snap.symbol, name: snap.name },
      score: i.event.score,
      confirmations,
      warnings: i.event.reasons,
      recommendation: 'PASS',
      raw: { event: i.event },
    };
  }

  let rec: StrategySignal['recommendation'] = 'PASS';
  if (i.event.signalType === 'VERIFIED_MAJOR_LAUNCH' && i.cfg.liveModeEnabled) {
    rec = 'LIVE_BUY_ALLOWED';
    confirmations.push('verified major launch — paper allowed and tiny live allowed');
  } else if (
    i.event.signalType === 'VERIFIED_MAJOR_LAUNCH' ||
    i.event.signalType === 'OFFICIAL_CONTRACT_POSTED'
  ) {
    rec = 'PAPER_BUY';
    confirmations.push('official CA confirmed on multiple sources');
  } else if (i.event.score >= i.cfg.EVENT_SCORE_THRESHOLD - 10) {
    rec = 'WATCH';
  }

  return {
    strategy: 'official_announcement',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score: i.event.score,
    confirmations,
    warnings: [...warnings, ...i.event.reasons],
    recommendation: rec,
    raw: { event: i.event },
  };
}
