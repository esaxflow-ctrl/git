/**
 * Smart-wallet cluster strategy.
 *
 * Looks for: 2+ unrelated elite wallets buying the same token within a short
 * window, with healthy liquidity, accelerating volume, no insider linkage,
 * and price not yet exhausted.
 */

import type { AppConfig } from '../config.js';
import type { StrategySignal, TokenSnapshot, WatchedWallet } from '../types.js';

export interface ClusterEntry {
  wallet: WatchedWallet;
  tradeTimeMs: number;
  priceUsdAtEntry: number;
}

export interface ClusterStrategyInputs {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  /** Recent buys on this token from watched wallets, newest first. */
  recentEntries: ClusterEntry[];
  /** Helper: pairs of wallets known to be linked (deployer chain etc.). */
  linkedPairs?: Set<string>;
  /** Wallets flagged as INSIDER/DEV. */
  insiderOrDev?: Set<string>;
  /** Volume acceleration score 0–100 (from supporting strategy). */
  volumeAccelerationScore: number;
}

export function clusterStrategy(input: ClusterStrategyInputs): StrategySignal {
  const { cfg, snapshot, recentEntries, volumeAccelerationScore } = input;
  const confirmations: string[] = [];
  const warnings: string[] = [];
  const linkedPairs = input.linkedPairs ?? new Set<string>();
  const insiderOrDev = input.insiderOrDev ?? new Set<string>();

  const elites = recentEntries.filter(
    (e) => e.wallet.score >= cfg.SMART_WALLET_MIN_SCORE && !insiderOrDev.has(e.wallet.address),
  );

  // Need at least 2 unrelated elite wallets within window.
  const windowMs = cfg.COPY_TRADE_MAX_DELAY_SECONDS * 1000 * 6; // cluster window 6x copy-delay
  const now = Date.now();
  const recent = elites.filter((e) => now - e.tradeTimeMs <= windowMs);

  if (recent.length < 2) {
    return mk({
      cfg,
      snapshot,
      score: Math.min(40, recent.length * 20),
      confirmations,
      warnings: [`only ${recent.length} elite wallet(s) within window`],
      recommendation: 'PASS',
    });
  }

  // Are any pairs linked?
  let linkedPairCount = 0;
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const a = recent[i]!.wallet.address;
      const b = recent[j]!.wallet.address;
      const k1 = `${a}|${b}`;
      const k2 = `${b}|${a}`;
      if (linkedPairs.has(k1) || linkedPairs.has(k2)) linkedPairCount++;
    }
  }
  if (linkedPairCount >= 1) {
    warnings.push(`${linkedPairCount} pairs of wallets are linked — cluster may be coordinated`);
  }

  // Has the price moved too much after the earliest elite entry?
  const earliest = recent.reduce((a, b) => (a.tradeTimeMs < b.tradeTimeMs ? a : b));
  const movePct =
    earliest.priceUsdAtEntry > 0
      ? ((snapshot.priceUsd - earliest.priceUsdAtEntry) / earliest.priceUsdAtEntry) * 100
      : 0;
  if (movePct > cfg.COPY_TRADE_MAX_MOVE_AFTER_WALLET_ENTRY_PERCENT) {
    return mk({
      cfg,
      snapshot,
      score: 30,
      confirmations,
      warnings: [
        ...warnings,
        `price moved ${movePct.toFixed(1)}% after first wallet entry > limit ${cfg.COPY_TRADE_MAX_MOVE_AFTER_WALLET_ENTRY_PERCENT}%`,
      ],
      recommendation: 'WATCH',
    });
  }

  // Delay since earliest entry.
  const delaySec = (now - earliest.tradeTimeMs) / 1000;
  if (delaySec > cfg.COPY_TRADE_MAX_DELAY_SECONDS) {
    return mk({
      cfg,
      snapshot,
      score: 35,
      confirmations,
      warnings: [...warnings, `delay since elite entry ${delaySec.toFixed(0)}s > ${cfg.COPY_TRADE_MAX_DELAY_SECONDS}s`],
      recommendation: 'WATCH',
    });
  }

  confirmations.push(`${recent.length} elite wallets bought within ${windowMs / 1000}s`);
  confirmations.push(`copy delay ${delaySec.toFixed(0)}s within limit`);
  confirmations.push(`price move since first entry ${movePct.toFixed(1)}% within limit`);
  if (volumeAccelerationScore >= 65) confirmations.push(`volume acceleration ${volumeAccelerationScore}`);

  let score = 50;
  score += Math.min(20, recent.length * 5);
  score += Math.round((volumeAccelerationScore / 100) * 20);
  if (linkedPairCount > 0) score -= 25;
  if (delaySec < cfg.COPY_TRADE_MAX_DELAY_SECONDS / 2) score += 5;

  score = Math.max(0, Math.min(100, score));

  return mk({
    cfg,
    snapshot,
    score,
    confirmations,
    warnings,
    recommendation: score >= 75 && linkedPairCount === 0 ? 'PAPER_BUY' : 'WATCH',
    raw: { recent, movePct, delaySec, linkedPairCount },
  });
}

function mk(args: {
  cfg: AppConfig;
  snapshot: TokenSnapshot;
  score: number;
  confirmations: string[];
  warnings: string[];
  recommendation: StrategySignal['recommendation'];
  raw?: Record<string, unknown>;
}): StrategySignal {
  return {
    strategy: 'smart_wallet_cluster',
    token: { address: args.snapshot.address, symbol: args.snapshot.symbol, name: args.snapshot.name },
    score: args.score,
    confirmations: args.confirmations,
    warnings: args.warnings,
    recommendation: args.recommendation,
    raw: args.raw,
  };
}
