import { describe, it, expect } from 'vitest';
import { computePositionSize } from '../risk/positionSizing.js';
import { testConfig } from './helpers.js';

describe('computePositionSize', () => {
  const cfg = testConfig({ MAX_TRADE_SOL: '0.1', MAX_WALLET_PERCENT_PER_TRADE: '5' });

  it('caps at MAX_TRADE_SOL', () => {
    const r = computePositionSize(cfg, {
      walletBalanceSol: 1000,           // huge wallet — wallet-percent cap is also 50 SOL
      strategy: 'volume_acceleration',
      liquidityUsd: 1_000_000,
      masterScore: 95,
      isLaunchpadOrEvent: false,
    });
    expect(r.sizeSol).toBeLessThanOrEqual(0.1);
  });

  it('caps at wallet-percent', () => {
    const r = computePositionSize(cfg, {
      walletBalanceSol: 1,              // 5% = 0.05 SOL — tighter than MAX_TRADE_SOL
      strategy: 'volume_acceleration',
      liquidityUsd: 1_000_000,
      masterScore: 95,
      isLaunchpadOrEvent: false,
    });
    expect(r.sizeSol).toBeLessThanOrEqual(0.05);
  });

  it('halves for borderline scores', () => {
    const high = computePositionSize(cfg, {
      walletBalanceSol: 1000,
      strategy: 'volume_acceleration',
      liquidityUsd: 1_000_000,
      masterScore: 95,
      isLaunchpadOrEvent: false,
    });
    const low = computePositionSize(cfg, {
      walletBalanceSol: 1000,
      strategy: 'volume_acceleration',
      liquidityUsd: 1_000_000,
      masterScore: 70, // below LIVE_BUY_THRESHOLD
      isLaunchpadOrEvent: false,
    });
    expect(low.sizeSol).toBeLessThan(high.sizeSol);
  });

  it('halves for launchpad/event trades', () => {
    const a = computePositionSize(cfg, {
      walletBalanceSol: 1000,
      strategy: 'pumpfun_bonding_curve',
      liquidityUsd: 1_000_000,
      masterScore: 95,
      isLaunchpadOrEvent: true,
    });
    const b = computePositionSize(cfg, {
      walletBalanceSol: 1000,
      strategy: 'volume_acceleration',
      liquidityUsd: 1_000_000,
      masterScore: 95,
      isLaunchpadOrEvent: false,
    });
    expect(a.sizeSol).toBeLessThan(b.sizeSol);
  });
});
