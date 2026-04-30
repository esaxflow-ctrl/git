/**
 * Tests for the NewsScanner main-loop wiring (Phase 5).
 *
 * Covers the chain: NewsCandidate -> persistConfirmedCandidates() ->
 * news_events table -> recentNewsEventForToken() -> scoreEvent ->
 * non-zero breakdown.event.
 *
 * The full evaluate() integration is not directly exercised here
 * because evaluate() is private to src/index.ts; instead the test
 * exercises the same chain at the boundary of the public DB helper +
 * scoreEvent function, which is what evaluate() itself calls.
 */

import { describe, it, expect } from 'vitest';
import { NewsScanner } from '../scanners/newsScanner.js';
import { scoreEvent } from '../scoring/eventScore.js';
import { fakeSnapshot, makeTempDb } from './helpers.js';
import { XAdapter } from '../adapters/x.js';
import { DexScreenerAdapter } from '../adapters/dexscreener.js';
import { BirdeyeAdapter } from '../adapters/birdeye.js';
import type { NewsCandidate, NewsScanner as _NS } from '../scanners/newsScanner.js';

void (null as unknown as _NS); // import-only reference for type clarity

const TOKEN_A = 'TokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'TokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function makeScanner(db: ReturnType<typeof makeTempDb>): NewsScanner {
  // No bearer / no real network calls in any of these tests — every
  // method we call goes through the persist path or the runOnce path
  // that short-circuits when X is unconfigured.
  return new NewsScanner(
    new XAdapter(''),
    new DexScreenerAdapter(),
    new BirdeyeAdapter(''),
    db,
  );
}

function fakeCandidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    source: { handle: '@official', category: 'official_project', credibility: 90 },
    post: {
      id: `post_${Math.random().toString(36).slice(2)}`,
      authorId: 'a1',
      authorHandle: '@official',
      authorVerified: true,
      authorFollowers: 100_000,
      text: `Big news: contract is ${TOKEN_A}`,
      createdAt: Date.now() - 5 * 60_000,
      retweets: 50,
      likes: 500,
      quotes: 10,
      replies: 30,
      containedAddresses: [TOKEN_A],
      containedCashtags: ['$TOKENA'],
    },
    contractAddress: TOKEN_A,
    caOnDexScreener: true,
    caOnBirdeye: true,
    competingCAs: 1,
    ...overrides,
  };
}

describe('NewsScanner.runOnce — empty x_accounts inactive behaviour', () => {
  it('returns all-zeros when x_accounts is empty', async () => {
    const db = makeTempDb();
    const scanner = makeScanner(db);
    const stats = await scanner.runOnce();
    expect(stats).toEqual({ accounts: 0, fetched: 0, persisted: 0 });
  });

  it('returns all-zeros when X is unconfigured even if x_accounts has rows', async () => {
    const db = makeTempDb();
    db.raw()
      .prepare(
        `INSERT INTO x_accounts(account_id, handle, category, credibility, notes, added_at) VALUES(?,?,?,?,?,?)`,
      )
      .run('1', '@official', 'official_project', 90, null, Date.now());
    const scanner = makeScanner(db); // bearer is empty
    const stats = await scanner.runOnce();
    expect(stats).toEqual({ accounts: 0, fetched: 0, persisted: 0 });
  });
});

describe('NewsScanner.persistConfirmedCandidates', () => {
  it('skips candidates with neither DexScreener nor Birdeye confirmation', () => {
    const db = makeTempDb();
    const scanner = makeScanner(db);
    const persisted = scanner.persistConfirmedCandidates([
      fakeCandidate({ caOnDexScreener: false, caOnBirdeye: false }),
      fakeCandidate({ caOnDexScreener: false, caOnBirdeye: false, contractAddress: TOKEN_B }),
    ]);
    expect(persisted).toBe(0);
    const rowCount = (db.raw().prepare(`SELECT COUNT(*) as c FROM news_events`).get() as { c: number })
      .c;
    expect(rowCount).toBe(0);
  });

  it('persists confirmed candidates with the right tokens_json shape', () => {
    const db = makeTempDb();
    const scanner = makeScanner(db);
    const cand = fakeCandidate({ caOnDexScreener: true, caOnBirdeye: false });
    const persisted = scanner.persistConfirmedCandidates([cand]);
    expect(persisted).toBe(1);
    const row = db
      .raw()
      .prepare(`SELECT id, tokens_json, source, credibility FROM news_events`)
      .get() as { id: string; tokens_json: string; source: string; credibility: number };
    expect(row.id).toBe(cand.post.id);
    expect(row.source).toBe('@official');
    expect(row.credibility).toBe(90);
    // tokens_json must be JSON.stringify([address]) so the LIKE query
    // in recentNewsEventForToken() can find it.
    expect(JSON.parse(row.tokens_json)).toEqual([TOKEN_A]);
  });

  it('persisted event is findable via recentNewsEventForToken()', () => {
    const db = makeTempDb();
    const scanner = makeScanner(db);
    scanner.persistConfirmedCandidates([fakeCandidate()]);
    const found = db.recentNewsEventForToken(TOKEN_A);
    expect(found).not.toBeNull();
    expect(found!.credibility).toBe(90);
    expect(found!.source).toBe('@official');
    // No row exists for an unrelated token.
    expect(db.recentNewsEventForToken('DifferentXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBeNull();
  });
});

describe('NewsScanner persisted-event chain produces non-zero scoreEvent', () => {
  it('persisted event + matching snapshot yields scoreEvent.score > 0', () => {
    const db = makeTempDb();
    const scanner = makeScanner(db);
    // Persist a confirmed event for TOKEN_A.
    const persisted = scanner.persistConfirmedCandidates([fakeCandidate()]);
    expect(persisted).toBe(1);
    const ev = db.recentNewsEventForToken(TOKEN_A);
    expect(ev).not.toBeNull();

    // Build a healthy snapshot for the same token that would naturally
    // arrive in evaluate(). The shape mirrors what evaluate() passes to
    // scoreEvent in src/index.ts.
    const snap = fakeSnapshot({ address: TOKEN_A, jupiterQuoteAvailable: true });
    const postAgeMin = Math.max(0, (Date.now() - ev!.publishedAt) / 60_000);
    const r = scoreEvent({
      sourceCredibility: ev!.credibility,
      caInOfficialSource: true,
      caOnDexScreener: snap.pairAddress !== null,
      caOnBirdeye: snap.top10HolderPct !== null,
      competingCAs: 1,
      buzzScore: 0,
      smartWalletScore: 0,
      volumeAccelerationScore: 0,
      snap,
      safetyScore: 90,
      postAgeMinutes: postAgeMin,
      narrativeScore: 0,
    });
    // Non-zero score is the wiring contract — exact value depends on
    // the credibility blending inside scoreEvent.
    expect(r.score).toBeGreaterThan(0);
  });

  it('absence of persisted event yields a neutral 0 (the safe-default path)', () => {
    const db = makeTempDb();
    // No events persisted. evaluate() would skip the scoreEvent call
    // entirely, leaving breakdown.event at its emptyBreakdown() default
    // of 0. We assert the chain's gating predicate (DB returns null)
    // since the actual `breakdown.event = 0` follows by construction.
    expect(db.recentNewsEventForToken(TOKEN_A)).toBeNull();
  });
});
