import { describe, it, expect, vi } from 'vitest';
import { PaperTrader } from '../execution/paperTrader.js';
import { fakeSignal, fakeSnapshot, makeTempDb, testConfig } from './helpers.js';

// Mock Jupiter so we don't make real network calls.
const fakeJupiter = {
  getQuote: vi.fn(async () => ({
    inputMint: 'sol',
    outputMint: 'mint',
    inAmount: '50000000',
    outAmount: '1000000',
    otherAmountThreshold: '900000',
    priceImpactPct: 0.5,
    slippageBps: 100,
    routePlan: [],
    contextSlot: 0,
    fetchedAt: Date.now(),
  })),
} as unknown as Parameters<typeof PaperTrader.prototype.openPosition>[0]['cfg'] extends never ? never : any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('paperTrader accounting', () => {
  it('opens a paper position and books partial + full exits', async () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const trader = new PaperTrader(cfg, db, fakeJupiter);
    const sig = fakeSignal();
    const snap = fakeSnapshot({ priceUsd: 0.001 });
    const open = await trader.openPosition({
      cfg,
      signal: sig,
      snapshot: snap,
      sizeSol: 0.05,
      reasonOpened: 'test',
    });
    expect(open.ok).toBe(true);
    expect(open.position).toBeDefined();
    expect(open.position!.entryPriceUsd).toBeGreaterThan(0.001); // priced up by impact+slippage

    // Partial exit at +50% — fraction 0.25.
    const upSnap = fakeSnapshot({ priceUsd: open.position!.entryPriceUsd * 1.5 });
    const partial = await trader.exit(open.position!, upSnap, 0.25, 'partial-50');
    expect(partial).toBeNull(); // partial returns null

    // Full close.
    const finalSnap = fakeSnapshot({ priceUsd: open.position!.entryPriceUsd * 2 });
    const closed = await trader.exit(open.position!, finalSnap, 1, 'full');
    expect(closed).not.toBeNull();
    expect(closed!.realisedPnlSol).toBeGreaterThan(0);
    db.close();
  });

  it('rejects when price impact exceeds limit', async () => {
    const cfg = testConfig({ MAX_PRICE_IMPACT_PERCENT: '1' });
    const db = makeTempDb();
    const highImpactJup = {
      getQuote: vi.fn(async () => ({
        inputMint: 'sol',
        outputMint: 'mint',
        inAmount: '50000000',
        outAmount: '1000000',
        otherAmountThreshold: '900000',
        priceImpactPct: 5,
        slippageBps: 100,
        routePlan: [],
        contextSlot: 0,
        fetchedAt: Date.now(),
      })),
    } as unknown as typeof fakeJupiter;
    const trader = new PaperTrader(cfg, db, highImpactJup);
    const r = await trader.openPosition({
      cfg,
      signal: fakeSignal(),
      snapshot: fakeSnapshot(),
      sizeSol: 0.05,
      reasonOpened: 'test',
    });
    expect(r.ok).toBe(false);
    db.close();
  });

  it('rejects size 0', async () => {
    const cfg = testConfig();
    const db = makeTempDb();
    const trader = new PaperTrader(cfg, db, fakeJupiter);
    const r = await trader.openPosition({
      cfg,
      signal: fakeSignal(),
      snapshot: fakeSnapshot(),
      sizeSol: 0,
      reasonOpened: 'test',
    });
    expect(r.ok).toBe(false);
    db.close();
  });
});
