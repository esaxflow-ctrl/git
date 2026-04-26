import { describe, it, expect } from 'vitest';
import { scoreTokenSafety } from '../scoring/tokenSafetyScore.js';
import { fakeSnapshot, testConfig } from './helpers.js';

describe('tokenSafetyScore', () => {
  const cfg = testConfig();

  it('passes a healthy token', () => {
    const r = scoreTokenSafety(cfg, fakeSnapshot());
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.label === 'SAFE_ENOUGH_TO_WATCH' || r.label === 'PASS_ONLY').toBe(true);
  });

  it('flags missing Jupiter route as CANNOT_EXECUTE', () => {
    const r = scoreTokenSafety(cfg, fakeSnapshot({ jupiterQuoteAvailable: false }));
    expect(r.label).toBe('CANNOT_EXECUTE');
    expect(r.score).toBeLessThan(40);
  });

  it('penalises high top-10 concentration', () => {
    const baseline = scoreTokenSafety(cfg, fakeSnapshot()).score;
    const r = scoreTokenSafety(cfg, fakeSnapshot({ top10HolderPct: 60 }));
    expect(r.score).toBeLessThan(baseline);
  });

  it('flags single-holder > 50% as TOO_MUCH_HOLDER_CONCENTRATION', () => {
    const r = scoreTokenSafety(cfg, fakeSnapshot({ topSingleHolderPct: 65 }));
    expect(r.label).toBe('TOO_MUCH_HOLDER_CONCENTRATION');
  });

  it('flags active mint authority as RUG_RISK', () => {
    const r = scoreTokenSafety(cfg, fakeSnapshot({ mintAuthorityActive: true }));
    expect(r.label).toBe('RUG_RISK');
    expect(r.score).toBeLessThan(40);
  });

  it('flags low liquidity', () => {
    const r = scoreTokenSafety(cfg, fakeSnapshot({ liquidityUsd: 100 }));
    expect(['LOW_LIQUIDITY', 'HIGH_RISK', 'PASS_ONLY']).toContain(r.label);
    expect(r.score).toBeLessThan(60);
  });
});
