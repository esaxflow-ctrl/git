import { describe, it, expect } from 'vitest';
import { loadConfig, _resetConfigForTests } from '../config.js';

describe('config', () => {
  it('defaults to paper mode with live disabled', () => {
    _resetConfigForTests();
    const cfg = loadConfig({});
    expect(cfg.PAPER_TRADING).toBe(true);
    expect(cfg.LIVE_TRADING).toBe(false);
    expect(cfg.liveModeEnabled).toBe(false);
  });

  it('refuses ambiguous LIVE+PAPER both true', () => {
    _resetConfigForTests();
    expect(() => loadConfig({ PAPER_TRADING: 'true', LIVE_TRADING: 'true' })).toThrow(/Ambiguous/);
  });

  it('only enables liveModeEnabled when LIVE=true and PAPER=false', () => {
    _resetConfigForTests();
    const cfg = loadConfig({ PAPER_TRADING: 'false', LIVE_TRADING: 'true' });
    expect(cfg.liveModeEnabled).toBe(true);
  });

  it('rejects bad MAX_TRADE_SOL', () => {
    _resetConfigForTests();
    expect(() => loadConfig({ MAX_TRADE_SOL: '0' })).toThrow();
  });

  it('rejects MAX_WALLET_PERCENT > 100', () => {
    _resetConfigForTests();
    expect(() => loadConfig({ MAX_WALLET_PERCENT_PER_TRADE: '150' })).toThrow();
  });

  it('rejects huge slippage', () => {
    _resetConfigForTests();
    expect(() => loadConfig({ MAX_SLIPPAGE_BPS: '10000' })).toThrow();
  });

  it('parses profit ladder', () => {
    _resetConfigForTests();
    const cfg = loadConfig({ PROFIT_LADDER: '50:0.25,100:0.5' });
    expect(cfg.profitLadder).toEqual([
      { pct: 50, fraction: 0.25 },
      { pct: 100, fraction: 0.5 },
    ]);
  });

  it('rejects bad profit ladder fraction', () => {
    _resetConfigForTests();
    expect(() => loadConfig({ PROFIT_LADDER: '50:1.5' })).toThrow();
  });
});
