import { describe, it, expect } from 'vitest';
import { scoreSourceStack, scoreFreshness } from '../scoring/discoverySignals.js';
import { scoreSmartWalletBuys } from '../scoring/smartWalletSignal.js';
import type { WatchedWallet } from '../types.js';

describe('scoreSourceStack', () => {
  it('returns 0 for no sources', () => {
    expect(scoreSourceStack([]).score).toBe(0);
  });

  it('penalises ds_boost (boosted tokens average -48% return)', () => {
    expect(scoreSourceStack(['ds_boost']).score).toBe(0);
    // boost cancels out a single weak source
    expect(scoreSourceStack(['ds_boost', 'ds_latest_profile']).score).toBeLessThanOrEqual(0);
  });

  it('rewards multi-source confirmation', () => {
    const r = scoreSourceStack(['birdeye_trending', 'migration']);
    expect(r.score).toBe(100);
    expect(r.notes.some((n) => n.includes('confirmed by'))).toBe(true);
  });

  it('flags ds_boost as a penalty in notes', () => {
    const r = scoreSourceStack(['birdeye_trending', 'ds_boost']);
    expect(r.notes.some((n) => n.includes('paid DexScreener boost'))).toBe(true);
  });
});

describe('scoreFreshness', () => {
  it('rejects pools younger than 1 minute (sniper window)', () => {
    expect(scoreFreshness(0.5).score).toBe(0);
  });
  it('peaks in the 1-15 minute window', () => {
    expect(scoreFreshness(5).score).toBe(100);
    expect(scoreFreshness(14).score).toBe(100);
  });
  it('decays after the productive window', () => {
    expect(scoreFreshness(30).score).toBe(70);
    expect(scoreFreshness(120).score).toBe(35);
    expect(scoreFreshness(600).score).toBe(15);
  });
  it('returns 0 past the discovery window', () => {
    expect(scoreFreshness(2000).score).toBe(0);
  });
});

describe('scoreSmartWalletBuys', () => {
  const elite = (addr: string, score = 80): WatchedWallet => ({
    address: addr,
    label: 'ELITE_COPYABLE',
    score,
    addedAt: 0,
  });
  const sniper = (addr: string): WatchedWallet => ({
    address: addr,
    label: 'SNIPER_BOT',
    score: 25,
    addedAt: 0,
  });

  it('returns 0 with no buys', () => {
    const r = scoreSmartWalletBuys([]);
    expect(r.smartWallet).toBe(0);
    expect(r.smartWalletCluster).toBe(0);
  });

  it('rewards a single recent ELITE buy', () => {
    const now = 1_000_000;
    const r = scoreSmartWalletBuys(
      [{ wallet: elite('0xabc'), blockTime: now - 5 * 60_000 }],
      now,
    );
    expect(r.smartWallet).toBeGreaterThanOrEqual(70);
  });

  it('ignores SNIPER_BOT buys (weight 0)', () => {
    const now = 1_000_000;
    const r = scoreSmartWalletBuys(
      [{ wallet: sniper('0xsnipe'), blockTime: now }],
      now,
    );
    expect(r.smartWallet).toBe(0);
    expect(r.smartWalletCluster).toBe(0);
  });

  it('cluster score scales with independent ELITE buyers', () => {
    const now = 1_000_000;
    const buys = [
      { wallet: elite('0xa'), blockTime: now - 5 * 60_000 },
      { wallet: elite('0xb'), blockTime: now - 10 * 60_000 },
      { wallet: elite('0xc'), blockTime: now - 15 * 60_000 },
    ];
    const r = scoreSmartWalletBuys(buys, now);
    expect(r.smartWalletCluster).toBeGreaterThanOrEqual(95);
    expect(r.count).toBe(3);
  });

  it('decays old buys towards zero', () => {
    const now = 1_000_000;
    const r = scoreSmartWalletBuys(
      [{ wallet: elite('0xa'), blockTime: now - 5 * 60 * 60_000 }], // 5h ago
      now,
    );
    // 5h is past the 30min full-credit window and approaching the 6h zero
    expect(r.smartWallet).toBeLessThan(20);
  });
});
