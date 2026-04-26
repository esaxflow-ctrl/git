import { describe, it, expect } from 'vitest';
import { scoreBuzz } from '../scoring/buzzScore.js';
import type { XPostMeta } from '../types.js';

function post(over: Partial<XPostMeta> = {}): XPostMeta {
  return {
    id: String(Math.random()),
    authorId: 'a' + Math.random(),
    authorHandle: 'someone',
    authorVerified: false,
    authorFollowers: 5_000,
    text: 'check out $FAKE awesome project',
    createdAt: Date.now(),
    retweets: 5,
    likes: 25,
    quotes: 1,
    replies: 3,
    containedAddresses: ['CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'],
    containedCashtags: ['$FAKE'],
    ...over,
  };
}

describe('buzzScore', () => {
  it('low without volume', () => {
    const r = scoreBuzz({ posts: [], windowMinutes: 30 });
    expect(r.score).toBe(0);
  });

  it('rises with mention velocity and unique authors', () => {
    const posts = Array.from({ length: 60 }, (_, i) =>
      post({ authorId: 'a' + i, text: `random unique text ${i}` }),
    );
    const r = scoreBuzz({ posts, windowMinutes: 30 });
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it('flags FAKE_CONTRACT_RISK with multiple distinct CAs', () => {
    const posts = Array.from({ length: 30 }, (_, i) =>
      post({
        authorId: 'a' + i,
        text: `seek $FAKE addr ${i}`,
        containedAddresses: [
          i % 2 === 0
            ? 'CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
            : 'CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2',
        ],
      }),
    );
    const r = scoreBuzz({ posts, windowMinutes: 30, contractAddress: 'CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' });
    expect(r.signalType).toBe('FAKE_CONTRACT_RISK');
  });

  it('penalises duplicate spam', () => {
    const posts = Array.from({ length: 30 }, (_, i) =>
      post({ authorId: 'a' + i, text: 'BUY NOW $FAKE TO THE MOON' }),
    );
    const r = scoreBuzz({ posts, windowMinutes: 10 });
    expect(r.reasons.join(' ')).toMatch(/spam|bot/i);
  });
});
