import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { RiskManager } from '../risk/riskManager.js';
import { KillSwitch } from '../risk/killSwitch.js';
import { fakeSignal, fakeSnapshot, makeTempDb, testConfig } from './helpers.js';

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) {
    const p = cleanups.pop();
    if (p && existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
});

describe('riskManager', () => {
  it('approves a healthy paper trade', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const r = rm.approve({
      signal: fakeSignal({ recommendation: 'PAPER_BUY' }),
      snapshot: fakeSnapshot(),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(true);
    db.close();
  });

  it('rejects when kill switch is engaged', () => {
    const cfg = testConfig();
    writeFileSync(cfg.KILL_SWITCH_FILE, 'STOP');
    cleanups.push(cfg.KILL_SWITCH_FILE);
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const r = rm.approve({
      signal: fakeSignal({ recommendation: 'PAPER_BUY' }),
      snapshot: fakeSnapshot(),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/kill switch/);
    db.close();
  });

  it('refuses live mode when liveModeEnabled is false', () => {
    const cfg = testConfig({ PAPER_TRADING: 'true', LIVE_TRADING: 'false' });
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const r = rm.approve({
      signal: fakeSignal({ recommendation: 'LIVE_BUY_ALLOWED' }),
      snapshot: fakeSnapshot(),
      quote: null,
      walletBalanceSol: 5,
      intendedMode: 'live',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/live mode requested/);
    db.close();
  });

  it('rejects below safety threshold', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const sig = fakeSignal({ recommendation: 'PAPER_BUY' });
    sig.breakdown.tokenSafety = 50;
    const r = rm.approve({
      signal: sig,
      snapshot: fakeSnapshot(),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    expect(r.reasons[0]).toMatch(/safety/);
    db.close();
  });

  it('rejects below liquidity minimum', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const r = rm.approve({
      signal: fakeSignal({ recommendation: 'PAPER_BUY' }),
      snapshot: fakeSnapshot({ liquidityUsd: 1_000 }),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    expect(r.reasons[0]).toMatch(/liquidity/);
    db.close();
  });

  it('rejects when too-late penalty too high', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const sig = fakeSignal({ recommendation: 'PAPER_BUY' });
    sig.breakdown.tooLatePenalty = 80;
    const r = rm.approve({
      signal: sig,
      snapshot: fakeSnapshot(),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    expect(r.reasons[0]).toMatch(/too-late/);
    db.close();
  });

  it('rejects holder-concentration', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const rm = new RiskManager(cfg, db, new KillSwitch(cfg.KILL_SWITCH_FILE));
    const r = rm.approve({
      signal: fakeSignal({ recommendation: 'PAPER_BUY' }),
      snapshot: fakeSnapshot({ top10HolderPct: 70 }),
      quote: null,
      walletBalanceSol: 1,
      intendedMode: 'paper',
      now: Date.now(),
    });
    expect(r.approved).toBe(false);
    db.close();
  });
});
