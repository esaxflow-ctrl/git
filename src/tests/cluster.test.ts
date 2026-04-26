import { describe, it, expect } from 'vitest';
import { clusterStrategy } from '../strategies/smartWalletClusterStrategy.js';
import { fakeSnapshot, testConfig } from './helpers.js';
import type { WatchedWallet } from '../types.js';

function wallet(addr: string, score = 85): WatchedWallet {
  return { address: addr, label: 'ELITE_COPYABLE', score, addedAt: 0 };
}

describe('smartWalletClusterStrategy', () => {
  const cfg = testConfig();
  const snap = fakeSnapshot({ priceUsd: 0.001 });

  it('passes with only one elite wallet', () => {
    const r = clusterStrategy({
      cfg,
      snapshot: snap,
      recentEntries: [{ wallet: wallet('A'), tradeTimeMs: Date.now(), priceUsdAtEntry: 0.001 }],
      volumeAccelerationScore: 70,
    });
    expect(r.recommendation).toBe('PASS');
  });

  it('rejects when copy delay too long', () => {
    const old = Date.now() - cfg.COPY_TRADE_MAX_DELAY_SECONDS * 1000 - 5_000;
    const r = clusterStrategy({
      cfg,
      snapshot: snap,
      recentEntries: [
        { wallet: wallet('A'), tradeTimeMs: old, priceUsdAtEntry: 0.001 },
        { wallet: wallet('B'), tradeTimeMs: old + 500, priceUsdAtEntry: 0.001 },
      ],
      volumeAccelerationScore: 70,
    });
    expect(r.recommendation).toBe('WATCH');
    expect(r.warnings.join(' ')).toMatch(/delay/);
  });

  it('rejects when price moved too much after first entry', () => {
    const now = Date.now();
    const r = clusterStrategy({
      cfg,
      snapshot: fakeSnapshot({ priceUsd: 0.0015 }),     // +50% from entry 0.001
      recentEntries: [
        { wallet: wallet('A'), tradeTimeMs: now, priceUsdAtEntry: 0.001 },
        { wallet: wallet('B'), tradeTimeMs: now + 200, priceUsdAtEntry: 0.0011 },
      ],
      volumeAccelerationScore: 70,
    });
    expect(r.recommendation).toBe('WATCH');
    expect(r.warnings.join(' ')).toMatch(/moved/);
  });

  it('paper-buys with two unrelated elite wallets and good conditions', () => {
    const now = Date.now();
    const r = clusterStrategy({
      cfg,
      snapshot: snap,
      recentEntries: [
        { wallet: wallet('A'), tradeTimeMs: now, priceUsdAtEntry: 0.001 },
        { wallet: wallet('B'), tradeTimeMs: now + 1000, priceUsdAtEntry: 0.001 },
      ],
      volumeAccelerationScore: 80,
    });
    expect(['PAPER_BUY', 'WATCH']).toContain(r.recommendation);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });
});
