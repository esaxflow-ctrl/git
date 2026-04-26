import { describe, it, expect } from 'vitest';
import { ExitManager } from '../execution/exitManager.js';
import { PaperTrader } from '../execution/paperTrader.js';
import { fakeSnapshot, makeTempDb, testConfig, fakeSignal } from './helpers.js';
import type { OpenPosition } from '../types.js';

function position(over: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: 'p1',
    mode: 'paper',
    token: { address: 'mint', symbol: 'FAKE', name: 'F' },
    strategy: 'volume_acceleration',
    entryTimestamp: Date.now() - 60_000,
    entryPriceUsd: 1,
    entrySolSpent: 0.05,
    tokenAmount: 50,
    highestPriceUsd: 1,
    partialExitsTaken: [],
    trailingStopActive: false,
    hardStopPriceUsd: 0.65,
    reasonOpened: 'test',
    signalSnapshot: fakeSignal(),
    ...over,
  };
}

const stubJupiter = {} as unknown as ConstructorParameters<typeof PaperTrader>[2];

describe('exitManager.decide', () => {
  it('hard stop triggers at price <= stop', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const d = ex.decide(position(), { snapshot: fakeSnapshot({ priceUsd: 0.5 }) });
    expect(d).not.toBeNull();
    expect(d!.fraction).toBe(1);
    expect(d!.reason).toMatch(/hard stop/);
    db.close();
  });

  it('liquidity drain triggers emergency exit', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const d = ex.decide(position(), {
      snapshot: fakeSnapshot({ priceUsd: 1 }),
      liquidityDelta: {
        tokenAddress: 'mint',
        kind: 'drained',
        fromUsd: 100_000,
        toUsd: 30_000,
        deltaUsd: -70_000,
        deltaPct: -70,
        withinSeconds: 120,
      },
    });
    expect(d?.emergency).toBe(true);
    expect(d?.fraction).toBe(1);
    db.close();
  });

  it('profit ladder triggers partial exit', () => {
    const cfg = testConfig({ PROFIT_LADDER: '50:0.25,100:0.25,200:0.25' });
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const d = ex.decide(position(), { snapshot: fakeSnapshot({ priceUsd: 1.5 }) });
    expect(d?.fraction).toBe(0.25);
    expect(d?.reason).toMatch(/profit ladder/);
    db.close();
  });

  it('trailing stop triggers after first partial', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const p = position({
      partialExitsTaken: [{ atPct: 50, fraction: 0.25, executedAt: Date.now(), priceUsd: 1.5 }],
      highestPriceUsd: 2,
    });
    const d = ex.decide(p, { snapshot: fakeSnapshot({ priceUsd: 1.5 }) });
    expect(d?.reason).toMatch(/trailing/);
    expect(d?.fraction).toBe(1);
    db.close();
  });

  it('time-based exit kicks in after limit', () => {
    const cfg = testConfig({ TIME_BASED_EXIT_MINUTES: '10' });
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const old = position({ entryTimestamp: Date.now() - 60 * 60_000, hardStopPriceUsd: 0.0001 });
    const d = ex.decide(old, { snapshot: fakeSnapshot({ priceUsd: 1.05 }) });
    expect(d?.reason).toMatch(/time-based/);
    db.close();
  });

  it('multiple elite sells force full exit on cluster trades', () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const ex = new ExitManager(cfg, db, new PaperTrader(cfg, db, stubJupiter));
    const p = position({ strategy: 'smart_wallet_cluster' });
    const d = ex.decide(p, {
      snapshot: fakeSnapshot({ priceUsd: 1.2 }),
      eliteSellersInLastWindow: 2,
    });
    expect(d?.fraction).toBe(1);
    expect(d?.emergency).toBe(true);
    db.close();
  });
});
