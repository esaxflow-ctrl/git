/**
 * Discovery-derived sub-scores: how the token surfaced (multi-source
 * confirmation), and whether it's in the productive freshness window.
 *
 * Both are cheap heuristics that meaningfully separate "garbage that
 * scrolled through DexScreener latest" from "token that's actually moving
 * across multiple independent feeds at the right age."
 */

export interface SourceStackResult {
  score: number;
  notes: string[];
}

/**
 * 0-100 score reflecting how strongly multiple discovery sources agreed.
 *
 * Source weights:
 *   birdeye_trending : 55 — Birdeye's volume-rank list (real volume)
 *   migration        : 45 — token just graduated from a launchpad
 *   ds_latest_profile: 10 — first-pass, mostly spam
 *   ds_boost         : -30 — PAID placement; independent analysis of >3,000
 *                       boost purchases found avg return of -48%. The boost
 *                       flag is a *negative* feature, not positive: it tells
 *                       you the team is paying for visibility to exit
 *                       liquidity. We score it as a penalty, capped to clamp
 *                       the overall score at 0 if every other source is weak.
 *
 * The score is the sum capped to [0, 100]. Examples:
 *   ds_latest_profile only         -> 10
 *   ds_boost only                  ->  0 (clamped)
 *   ds_boost + ds_latest_profile   ->  0 (boost cancels)
 *   migration confirmed by Birdeye -> 100
 */
const SOURCE_WEIGHT: Record<string, number> = {
  birdeye_trending: 55,
  migration: 45,
  ds_latest_profile: 10,
  ds_boost: -30,
};

export function scoreSourceStack(sources: string[]): SourceStackResult {
  const notes: string[] = [];
  if (sources.length === 0) return { score: 0, notes };
  let total = 0;
  for (const s of sources) {
    const w = SOURCE_WEIGHT[s] ?? 0;
    total += w;
  }
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const positive = sources.filter((s) => (SOURCE_WEIGHT[s] ?? 0) > 0);
  if (sources.includes('ds_boost')) {
    notes.push('penalised: paid DexScreener boost (boosted tokens avg -48% return)');
  }
  if (positive.length >= 2) {
    notes.push(`confirmed by ${positive.length} independent sources: ${positive.join(', ')}`);
  } else if (score >= 50) {
    notes.push(`high-quality source: ${positive[0]}`);
  }
  return { score, notes };
}

export interface FreshnessResult {
  score: number;
  notes: string[];
  warnings: string[];
}

/**
 * Pool-age freshness score.
 *
 * Per the academic pump.fun success-prediction work + active-trader
 * post-mortems, the highest-information windows are:
 *   - first ~60s post-Raydium-migration: snipe-only, retail hasn't woken up
 *   - 1-15 min post-launch: peak discovery window, smart-money clusters form
 *   - 15-60 min: still actionable when smart wallets confirm
 *   - >60 min: asymmetry mostly gone unless cluster is actively accumulating
 *
 *   < 1 min     :  0  — too early; price action is mostly snipers
 *   1 – 15 min  : 100 — peak discovery sweet spot (research-backed)
 *   15 – 60 min : 70  — still actionable with confirmation
 *   1 – 4 h     : 35  — only with strong cluster + narrative
 *   4 – 12 h    : 15  — late
 *   > 12 h      :  0  — past discovery window
 */
export function scoreFreshness(poolAgeMinutes: number): FreshnessResult {
  const notes: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  const m = poolAgeMinutes;
  if (m < 1) {
    score = 0;
    warnings.push(`pool ${m.toFixed(1)} min old — too early; sniper-dominated`);
  } else if (m <= 15) {
    score = 100;
    notes.push(`pool ${m.toFixed(0)} min old — peak discovery window`);
  } else if (m <= 60) {
    score = 70;
    notes.push(`pool ${m.toFixed(0)} min old — actionable with confirmation`);
  } else if (m <= 240) {
    score = 35;
    warnings.push(`pool ${(m / 60).toFixed(1)}h old — late, needs strong confirmation`);
  } else if (m <= 720) {
    score = 15;
    warnings.push(`pool ${(m / 60).toFixed(1)}h old — likely too late`);
  } else {
    score = 0;
    warnings.push(`pool ${(m / 60).toFixed(1)}h old — past discovery window`);
  }
  return { score, notes, warnings };
}
