/**
 * Event score (0–100) for major catalysts: official launches, exchange
 * listings, celebrity/political/brand coins.
 *
 * Verified launches require the SAME contract address to appear in:
 *   - the official source (X post, project site)
 *   - and DexScreener/Birdeye
 *   - and to have a working Jupiter route
 *
 * If those three confirmations don't agree, we drop into POSSIBLE_MAJOR_LAUNCH
 * or FAKE_LAUNCH_RISK.
 */

import type { EventSignalType, TokenSnapshot } from '../types.js';

export interface EventInputs {
  /** 0–100; how trustworthy the source posting the CA is. */
  sourceCredibility: number;
  /** Was the CA literally present in the official post / page? */
  caInOfficialSource: boolean;
  /** Does the same CA appear on DexScreener? */
  caOnDexScreener: boolean;
  /** Does the same CA appear on Birdeye? */
  caOnBirdeye: boolean;
  /** Multiple competing CAs being shared by different "official-looking" posts? */
  competingCAs: number;
  /** Buzz score 0–100 around this event. */
  buzzScore: number;
  /** Smart wallet activity score 0–100. */
  smartWalletScore: number;
  /** Volume acceleration score 0–100. */
  volumeAccelerationScore: number;
  /** Token snapshot (for liquidity, holder, jupiter checks). */
  snap: TokenSnapshot;
  /** Token safety score 0–100. */
  safetyScore: number;
  /** Optional: minutes since the official post. */
  postAgeMinutes: number;
  /** Optional: was the original post deleted? */
  postDeleted?: boolean;
  /** Narrative score 0–100 — supporting only. */
  narrativeScore: number;
}

export interface EventResult {
  score: number;
  signalType: EventSignalType;
  reasons: string[];
}

export function scoreEvent(i: EventInputs): EventResult {
  const reasons: string[] = [];
  let score = 0;

  // ---- Source credibility (0..25) -----------------------------------------
  score += Math.round((i.sourceCredibility / 100) * 25);

  // ---- Confirmations strength (0..30) -------------------------------------
  let confirmations = 0;
  if (i.caInOfficialSource) confirmations++;
  if (i.caOnDexScreener) confirmations++;
  if (i.caOnBirdeye) confirmations++;
  if (i.snap.jupiterQuoteAvailable) confirmations++;
  score += [0, 8, 16, 24, 30][confirmations] ?? 30;

  // ---- Liquidity / safety / smart wallet supporting (0..25) ---------------
  score += Math.round((i.safetyScore / 100) * 10);
  score += Math.round((i.smartWalletScore / 100) * 8);
  score += Math.round((i.volumeAccelerationScore / 100) * 7);

  // ---- Buzz support (0..10) -----------------------------------------------
  score += Math.round((i.buzzScore / 100) * 10);

  // ---- Narrative support (0..5) — supporting only -------------------------
  score += Math.round((i.narrativeScore / 100) * 5);

  // ---- Penalties ----------------------------------------------------------
  if (i.competingCAs > 1) {
    score -= 25;
    reasons.push(`${i.competingCAs} competing CAs — fake launch risk`);
  }
  if (i.postDeleted) {
    score -= 30;
    reasons.push('original official post deleted');
  }
  if (i.postAgeMinutes > 60) {
    score -= 15;
    reasons.push(`post age ${i.postAgeMinutes.toFixed(0)} min — likely too late`);
  } else if (i.postAgeMinutes > 30) {
    score -= 8;
  }

  if (!i.snap.jupiterQuoteAvailable) {
    score -= 30;
    reasons.push('no Jupiter route');
  }

  score = Math.max(0, Math.min(100, score));

  // ---- Label --------------------------------------------------------------
  let signalType: EventSignalType = 'POSSIBLE_MAJOR_LAUNCH';
  if (i.competingCAs > 1) signalType = 'FAKE_LAUNCH_RISK';
  else if (i.postDeleted) signalType = 'FAKE_LAUNCH_RISK';
  else if (
    confirmations >= 3 &&
    i.sourceCredibility >= 80 &&
    i.snap.jupiterQuoteAvailable &&
    i.postAgeMinutes <= 30 &&
    score >= 80
  )
    signalType = 'VERIFIED_MAJOR_LAUNCH';
  else if (i.postAgeMinutes > 60 || score < 50) signalType = 'TOO_LATE_PASS';
  else if (i.buzzScore >= 90 && i.volumeAccelerationScore >= 70) signalType = 'SOCIAL_EXPLOSION';
  else if (i.caInOfficialSource && confirmations >= 2) signalType = 'OFFICIAL_CONTRACT_POSTED';

  return { score, signalType, reasons };
}
