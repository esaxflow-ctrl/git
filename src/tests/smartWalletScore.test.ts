import { describe, it, expect } from 'vitest';
import { scoreSmartWallet } from '../scoring/smartWalletScore.js';
import type { WalletScoreBreakdown } from '../types.js';

function base(over: Partial<WalletScoreBreakdown> = {}): WalletScoreBreakdown {
  return {
    realisedPnl7d: 0,
    realisedPnl30d: 5,
    realisedPnl90d: 12,
    winRate: 0.55,
    avgWin: 1.5,
    avgLoss: 0.7,
    profitFactor: 2.1,
    expectancy: 0.18,
    maxDrawdown: 0.3,
    trades: 50,
    avgEntryMcUsd: 1_000_000,
    avgExitMcUsd: 5_000_000,
    avgHoldMinutes: 90,
    earlyEntryRate: 0.5,
    liquidityAdjustedPnl: 4,
    repeatabilityScore: 80,
    copyabilityScore: 75,
    rugExposure: 5,
    suspiciousBehaviourScore: 5,
    rawScore: 0,
    ...over,
  };
}

describe('smartWalletScore', () => {
  it('rates a strong wallet ELITE_COPYABLE', () => {
    const r = scoreSmartWallet(base({ winRate: 0.65, profitFactor: 3.5, expectancy: 0.4 }));
    expect(r.label).toBe('ELITE_COPYABLE');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('flags deployer-funded wallets as INSIDER_LIKELY', () => {
    const r = scoreSmartWallet(base(), true /* fundedByDeployer */, false);
    expect(r.label).toBe('INSIDER_LIKELY');
    expect(r.score).toBeLessThan(60);
  });

  it('flags suspected dev wallets as DEV_WALLET_LIKELY', () => {
    const r = scoreSmartWallet(base(), false, true /* deployerLikely */);
    expect(r.label).toBe('DEV_WALLET_LIKELY');
  });

  it('flags sniper bots by hold time', () => {
    const r = scoreSmartWallet(base({ avgHoldMinutes: 0.5 }));
    expect(r.label).toBe('SNIPER_BOT');
  });

  it('penalises tiny sample size', () => {
    const r = scoreSmartWallet(base({ trades: 5 }));
    expect(r.score).toBeLessThan(60);
  });

  it('penalises 1-3-big-wins pattern', () => {
    const r = scoreSmartWallet(base({ trades: 30, winRate: 0.4, profitFactor: 8, expectancy: 0.01 }));
    expect(r.reasons.join(' ')).toMatch(/concentrated|repeatable/i);
  });
});
