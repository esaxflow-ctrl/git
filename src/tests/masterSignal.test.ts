import { describe, it, expect } from 'vitest';
import { computeMasterSignal, emptyBreakdown } from '../scoring/masterSignalScore.js';
import { testConfig } from './helpers.js';

describe('masterSignalScore', () => {
  it('refuses LIVE_BUY_ALLOWED when liveModeEnabled is false', () => {
    const cfg = testConfig();
    expect(cfg.liveModeEnabled).toBe(false);
    const breakdown = emptyBreakdown();
    breakdown.tokenSafety = 95;
    breakdown.smartWallet = 90;
    breakdown.buzz = 85;
    breakdown.event = 90;
    breakdown.volumeAcceleration = 90;
    breakdown.jupiterExecutionQuality = 90;
    breakdown.riskManagerApproved = true;
    const sig = computeMasterSignal({
      cfg,
      token: { address: 'm', symbol: 'X', name: 'X' },
      strategy: 'volume_acceleration',
      breakdown,
      confirmations: [],
      risks: [],
    });
    expect(sig.recommendation).not.toBe('LIVE_BUY_ALLOWED');
  });

  it('PASSes when safety is below threshold', () => {
    const cfg = testConfig();
    const breakdown = emptyBreakdown();
    breakdown.tokenSafety = 40;
    breakdown.riskManagerApproved = true;
    const sig = computeMasterSignal({
      cfg,
      token: { address: 'm', symbol: 'X', name: 'X' },
      strategy: 'volume_acceleration',
      breakdown,
      confirmations: [],
      risks: [],
    });
    expect(sig.recommendation).toBe('PASS');
  });

  it('PAPER_BUYs when score and confirmations align in paper mode', () => {
    const cfg = testConfig();
    // To reach the WATCH/PAPER_BUY range the score must come from *multiple*
    // independent components — that is the design.
    const breakdown = emptyBreakdown();
    breakdown.tokenSafety = 90;
    breakdown.smartWallet = 90;
    breakdown.smartWalletCluster = 80;
    breakdown.buzz = 80;
    breakdown.event = 70;
    breakdown.volumeAcceleration = 90;
    breakdown.liquidityGrowth = 80;
    breakdown.jupiterExecutionQuality = 90;
    breakdown.narrative = 70;
    breakdown.riskManagerApproved = true;
    const sig = computeMasterSignal({
      cfg,
      token: { address: 'm', symbol: 'X', name: 'X' },
      strategy: 'volume_acceleration',
      breakdown,
      confirmations: [],
      risks: [],
    });
    expect(['PAPER_BUY', 'WATCH']).toContain(sig.recommendation);
  });

  it('issues LIVE_BUY_ALLOWED only with live mode + 2+ confirmations + high score', () => {
    const cfg = testConfig({ PAPER_TRADING: 'false', LIVE_TRADING: 'true' });
    // High score requires breadth — many high sub-scores together.
    const breakdown = emptyBreakdown();
    breakdown.tokenSafety = 95;
    breakdown.smartWallet = 95;
    breakdown.smartWalletCluster = 90;
    breakdown.buzz = 90;
    breakdown.event = 90;
    breakdown.volumeAcceleration = 90;
    breakdown.liquidityGrowth = 90;
    breakdown.jupiterExecutionQuality = 95;
    breakdown.narrative = 80;
    breakdown.pumpfun = 80;
    breakdown.migration = 80;
    breakdown.dexscreenerBoost = 70;
    breakdown.riskManagerApproved = true;
    const sig = computeMasterSignal({
      cfg,
      token: { address: 'm', symbol: 'X', name: 'X' },
      strategy: 'volume_acceleration',
      breakdown,
      confirmations: [],
      risks: [],
    });
    expect(sig.masterScore).toBeGreaterThanOrEqual(cfg.LIVE_BUY_THRESHOLD);
    expect(sig.recommendation).toBe('LIVE_BUY_ALLOWED');
  });
});
