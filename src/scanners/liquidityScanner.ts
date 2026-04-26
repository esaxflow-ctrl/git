/**
 * Liquidity scanner: tracks liquidity changes per token over time.
 *
 * Stateless on disk; uses an in-memory ring of recent samples. The exit
 * manager subscribes to detected drains.
 */

import type { TokenSnapshot } from '../types.js';

export type LiquidityEventKind = 'added' | 'removed' | 'drained' | 'stable';

export interface LiquiditySample {
  ts: number;
  liquidityUsd: number;
}

export interface LiquidityDelta {
  tokenAddress: string;
  kind: LiquidityEventKind;
  fromUsd: number;
  toUsd: number;
  deltaUsd: number;
  deltaPct: number;
  withinSeconds: number;
}

export class LiquidityScanner {
  private history = new Map<string, LiquiditySample[]>();
  /** Drained = >= 30% drop in <= 5 min (configurable). */
  private drainThresholdPct = 30;
  private drainWindowMs = 5 * 60_000;

  observe(snap: TokenSnapshot): LiquidityDelta | null {
    const arr = this.history.get(snap.address) ?? [];
    arr.push({ ts: snap.fetchedAt, liquidityUsd: snap.liquidityUsd });
    while (arr.length && snap.fetchedAt - arr[0]!.ts > 60 * 60_000) arr.shift();
    this.history.set(snap.address, arr);

    if (arr.length < 2) return null;
    const first = arr[0]!;
    const last = arr[arr.length - 1]!;
    const deltaUsd = last.liquidityUsd - first.liquidityUsd;
    const deltaPct = first.liquidityUsd > 0 ? (deltaUsd / first.liquidityUsd) * 100 : 0;
    const within = (last.ts - first.ts) / 1000;

    let kind: LiquidityEventKind = 'stable';
    if (deltaPct <= -this.drainThresholdPct && last.ts - first.ts <= this.drainWindowMs) {
      kind = 'drained';
    } else if (deltaPct < -10) kind = 'removed';
    else if (deltaPct > 10) kind = 'added';

    return {
      tokenAddress: snap.address,
      kind,
      fromUsd: first.liquidityUsd,
      toUsd: last.liquidityUsd,
      deltaUsd,
      deltaPct,
      withinSeconds: within,
    };
  }
}
