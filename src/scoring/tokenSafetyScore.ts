/**
 * Token safety score (0–100) + safety label.
 *
 * Pure function over a TokenSnapshot + AppConfig. No I/O. Returns a list of
 * human-readable reasons explaining the score.
 */

import type { AppConfig } from '../config.js';
import type { SafetyLabel, TokenSnapshot } from '../types.js';

export interface SafetyResult {
  score: number;
  label: SafetyLabel;
  reasons: string[];
  hardFails: string[];
}

const HARD_FAIL_FLOOR = 30; // hard fails clamp the score below this

export function scoreTokenSafety(cfg: AppConfig, snap: TokenSnapshot): SafetyResult {
  let score = 100;
  const reasons: string[] = [];
  const hardFails: string[] = [];

  // ---- Hard fails (drop the score to <= floor) ------------------------------
  if (!snap.jupiterQuoteAvailable) {
    hardFails.push('no Jupiter quote available');
  }
  if (snap.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD / 5) {
    hardFails.push(`liquidity $${snap.liquidityUsd.toFixed(0)} extremely low`);
  }
  if (snap.mintAuthorityActive === true) {
    hardFails.push('mint authority still active (issuer can mint more supply)');
  }
  if (snap.freezeAuthorityActive === true) {
    hardFails.push('freeze authority still active');
  }
  if (snap.topSingleHolderPct !== null && snap.topSingleHolderPct > 50) {
    hardFails.push(`single holder owns ${snap.topSingleHolderPct.toFixed(1)}% of supply`);
  }

  // ---- Soft penalties --------------------------------------------------------
  if (snap.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD) {
    score -= 25;
    reasons.push(`liquidity $${snap.liquidityUsd.toFixed(0)} < min $${cfg.MIN_TOKEN_LIQUIDITY_USD}`);
  } else if (snap.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD * 2) {
    score -= 10;
    reasons.push(`liquidity thin`);
  }

  if (snap.volume5mUsd < cfg.MIN_VOLUME_5M_USD) {
    score -= 10;
    reasons.push(`5m volume below minimum`);
  }
  if (snap.volume1hUsd < cfg.MIN_VOLUME_1H_USD) {
    score -= 5;
    reasons.push(`1h volume below minimum`);
  }
  if (snap.uniqueBuyers5m < cfg.MIN_UNIQUE_BUYERS_5M) {
    score -= 10;
    reasons.push(`only ${snap.uniqueBuyers5m} unique buyers in 5m`);
  }

  if (
    snap.estPriceImpactPct !== null &&
    snap.estPriceImpactPct > cfg.MAX_PRICE_IMPACT_PERCENT
  ) {
    score -= 10;
    reasons.push(`est price impact ${snap.estPriceImpactPct.toFixed(2)}% > limit`);
  }

  if (snap.top10HolderPct !== null && snap.top10HolderPct > cfg.MAX_TOP_10_HOLDER_PERCENT) {
    score -= 15;
    reasons.push(`top-10 holders ${snap.top10HolderPct.toFixed(1)}% concentrated`);
  }
  if (
    snap.topSingleHolderPct !== null &&
    snap.topSingleHolderPct > cfg.MAX_SINGLE_HOLDER_PERCENT
  ) {
    score -= 10;
    reasons.push(`top single holder ${snap.topSingleHolderPct.toFixed(1)}%`);
  }

  // Liquidity-to-marketcap heuristic.
  if (snap.marketCapUsd > 0 && snap.liquidityUsd > 0) {
    const ratio = snap.liquidityUsd / snap.marketCapUsd;
    if (ratio < 0.02) {
      score -= 10;
      reasons.push(`liquidity/mcap ratio ${(ratio * 100).toFixed(2)}% (very thin)`);
    }
  }

  // Buy/sell skew can hint at honeypot or exhausting demand.
  const totalTx = snap.buyCount5m + snap.sellCount5m;
  if (totalTx > 20) {
    const sellRatio = snap.sellCount5m / Math.max(1, totalTx);
    if (sellRatio > 0.7) {
      score -= 8;
      reasons.push(`sell-heavy 5m (${(sellRatio * 100).toFixed(0)}% sells)`);
    }
  }

  // Brand-new pool penalty (extra caution under 5 min).
  if (snap.poolAgeMinutes < 5) {
    score -= 5;
    reasons.push(`pool < 5 min old`);
  }

  // ---- Apply hard fails ------------------------------------------------------
  if (hardFails.length > 0) {
    score = Math.min(score, HARD_FAIL_FLOOR - 1);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ---- Label assignment ------------------------------------------------------
  let label: SafetyLabel = 'SAFE_ENOUGH_TO_WATCH';
  if (!snap.jupiterQuoteAvailable) label = 'CANNOT_EXECUTE';
  else if (
    snap.topSingleHolderPct !== null &&
    snap.topSingleHolderPct > 50
  )
    label = 'TOO_MUCH_HOLDER_CONCENTRATION';
  else if (snap.mintAuthorityActive === true || snap.freezeAuthorityActive === true)
    label = 'RUG_RISK';
  else if (snap.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD / 2) label = 'LOW_LIQUIDITY';
  else if (score < 40) label = 'HIGH_RISK';
  else if (score < cfg.TOKEN_SAFETY_THRESHOLD) label = 'PASS_ONLY';

  return { score, label, reasons: [...hardFails, ...reasons], hardFails };
}
