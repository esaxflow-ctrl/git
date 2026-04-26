import { describe, it, expect } from 'vitest';
import { scoreTooLate } from '../scoring/tooLateScore.js';
import { fakeSnapshot } from './helpers.js';

describe('tooLateScore', () => {
  it('low penalty on early/healthy snapshot', () => {
    const r = scoreTooLate({
      snap: fakeSnapshot({ priceChange5mPct: 5, priceChange1hPct: 30, volume5mUsd: 30_000, volume1hUsd: 250_000 }),
      buzzScoreNow: 70,
      buzzScorePrior: 50,
      eliteSellersLastHour: 0,
      hoursSinceMcDoubled: null,
    });
    expect(r.penalty).toBeLessThan(30);
  });

  it('high penalty on vertical move + buzz collapse + sellers', () => {
    const r = scoreTooLate({
      snap: fakeSnapshot({ priceChange5mPct: 100, priceChange1hPct: 400, volume5mUsd: 5_000, volume1hUsd: 250_000 }),
      buzzScoreNow: 30,
      buzzScorePrior: 90,
      eliteSellersLastHour: 3,
      hoursSinceMcDoubled: 0.2,
    });
    expect(r.penalty).toBeGreaterThan(60);
  });
});
