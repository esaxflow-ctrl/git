/**
 * Narrative rotation score (0–100) per narrative.
 *
 * Inputs are aggregated stats over the universe of tokens that match a
 * narrative's keyword set. The score is intended to be used as a *supporting*
 * input; never as a sole buy trigger.
 */

export interface NarrativeInputs {
  totalVolumeChangePct: number;
  tokensPumping: number;
  socialMentionVelocity: number;     // mentions per minute
  uniqueAccountsDiscussing: number;
  smartWalletParticipation: number;  // count of elite-wallet entries
  newLaunches: number;
  avgLiquidityGrowthPct: number;
  avgMarketCapGrowthPct: number;
}

export interface NarrativeResult {
  score: number;
  reasons: string[];
}

export function scoreNarrative(i: NarrativeInputs): NarrativeResult {
  const reasons: string[] = [];
  let score = 0;

  if (i.totalVolumeChangePct >= 200) {
    score += 25;
    reasons.push(`narrative volume +${i.totalVolumeChangePct.toFixed(0)}%`);
  } else if (i.totalVolumeChangePct >= 100) score += 15;
  else if (i.totalVolumeChangePct >= 50) score += 8;

  if (i.tokensPumping >= 10) score += 15;
  else if (i.tokensPumping >= 5) score += 8;

  if (i.socialMentionVelocity >= 20) score += 15;
  else if (i.socialMentionVelocity >= 5) score += 8;

  if (i.uniqueAccountsDiscussing >= 200) score += 10;
  else if (i.uniqueAccountsDiscussing >= 50) score += 5;

  if (i.smartWalletParticipation >= 5) score += 15;
  else if (i.smartWalletParticipation >= 2) score += 8;

  if (i.newLaunches >= 3) score += 5;

  if (i.avgLiquidityGrowthPct >= 50) score += 10;
  else if (i.avgLiquidityGrowthPct >= 20) score += 5;

  if (i.avgMarketCapGrowthPct >= 100) score += 5;

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}
