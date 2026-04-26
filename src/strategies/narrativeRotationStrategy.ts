/**
 * Narrative rotation strategy.
 *
 * NEVER a standalone trigger. This strategy can recommend WATCH and adds a
 * narrative-score input to the master signal. Tokens scoring well here
 * still need an independent strategy to actually fire.
 */

import type { AppConfig } from '../config.js';
import type { NarrativeResult } from '../scoring/narrativeScore.js';
import type { StrategySignal, TokenSnapshot } from '../types.js';

export interface NarrativeRotationInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  narrative: { name: string; score: NarrativeResult };
  /** Token's own membership-confidence in the narrative (0..1). */
  membership: number;
}

export function narrativeRotationStrategy(i: NarrativeRotationInputs): StrategySignal {
  const snap = i.snapshot;
  const confirmations: string[] = [];
  const adjusted = Math.round(i.narrative.score.score * Math.max(0, Math.min(1, i.membership)));

  if (adjusted >= i.cfg.NARRATIVE_SCORE_THRESHOLD) {
    confirmations.push(`narrative "${i.narrative.name}" score ${adjusted} (membership ${(i.membership * 100).toFixed(0)}%)`);
  }
  return {
    strategy: 'narrative_rotation',
    token: { address: snap.address, symbol: snap.symbol, name: snap.name },
    score: adjusted,
    confirmations,
    warnings: ['narrative is supporting only — never live-buy on narrative alone'],
    recommendation: adjusted >= i.cfg.NARRATIVE_SCORE_THRESHOLD ? 'WATCH' : 'PASS',
    raw: { narrative: i.narrative.name, membership: i.membership },
  };
}
