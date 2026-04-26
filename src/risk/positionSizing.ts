/**
 * Position sizing. Always returns a value <= MAX_TRADE_SOL and <= the
 * walletPercent cap. Strategy / liquidity / score modulate the size *down*,
 * never up.
 *
 * Sizes never grow proportionally with conviction past the cap. A great
 * setup at 50% conviction and a great setup at 95% conviction both land
 * within MAX_TRADE_SOL — score affects whether we trade at all, and whether
 * we use the small-tier or full-cap version, but never goes beyond the cap.
 */

import type { AppConfig } from '../config.js';
import type { StrategySource, TokenSnapshot } from '../types.js';

export interface SizingInputs {
  walletBalanceSol: number;
  strategy: StrategySource;
  liquidityUsd: number;
  masterScore: number;
  isLaunchpadOrEvent: boolean;
}

export interface SizingResult {
  sizeSol: number;
  reasons: string[];
}

export function computePositionSize(cfg: AppConfig, input: SizingInputs): SizingResult {
  const reasons: string[] = [];
  const cap = cfg.MAX_TRADE_SOL;
  const walletCap = (input.walletBalanceSol * cfg.MAX_WALLET_PERCENT_PER_TRADE) / 100;

  let size = Math.min(cap, walletCap);
  reasons.push(
    `base size = min(MAX_TRADE_SOL=${cap} SOL, ${cfg.MAX_WALLET_PERCENT_PER_TRADE}% of wallet=${walletCap.toFixed(4)} SOL)`,
  );

  // Score-based tiering: under-score multipliers.
  if (input.masterScore < cfg.LIVE_BUY_THRESHOLD) {
    size *= 0.5;
    reasons.push(`score below LIVE_BUY_THRESHOLD: size halved`);
  } else if (input.masterScore < cfg.LIVE_BUY_THRESHOLD + 5) {
    size *= 0.75;
    reasons.push(`score borderline: size scaled to 75%`);
  }

  // Liquidity-aware: shrink for thin pools so price impact stays low.
  if (input.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD * 2) {
    size *= 0.5;
    reasons.push(`liquidity < 2x minimum: size halved`);
  } else if (input.liquidityUsd < cfg.MIN_TOKEN_LIQUIDITY_USD * 4) {
    size *= 0.75;
    reasons.push(`liquidity < 4x minimum: size at 75%`);
  }

  // Event / launchpad trades get a smaller default — high uncertainty.
  if (input.isLaunchpadOrEvent) {
    size *= 0.5;
    reasons.push(`launchpad/event trade: size halved`);
  }

  // Floor: do not bother with sub-dust trades.
  if (size < 0.001) {
    return { sizeSol: 0, reasons: [...reasons, 'size below 0.001 SOL floor: trade skipped'] };
  }

  // Final cap re-clamp (defensive).
  size = Math.min(size, cap, walletCap);
  return { sizeSol: Number(size.toFixed(6)), reasons };
}

/** Convenience wrapper using a snapshot. */
export function sizeForSnapshot(
  cfg: AppConfig,
  snap: TokenSnapshot,
  input: Omit<SizingInputs, 'liquidityUsd'>,
): SizingResult {
  return computePositionSize(cfg, { ...input, liquidityUsd: snap.liquidityUsd });
}
