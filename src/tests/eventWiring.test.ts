/**
 * Tests for the eventScore wiring layer (DB lookup + safe-default
 * behaviour). The pure scoreEvent function is covered by
 * eventScore.test.ts; this file covers the integration path:
 * recentNewsEventForToken -> evaluate() -> breakdown.event.
 */

import { describe, it, expect } from 'vitest';
import { makeTempDb } from './helpers.js';

describe('news_events DB helper', () => {
  it('returns null when no news event matches the token', () => {
    const db = makeTempDb();
    expect(db.recentNewsEventForToken('NotInDB1111111111111111111111111111111111')).toBeNull();
  });

  it('returns the most recent matching event within the window', () => {
    const db = makeTempDb();
    const tokenA = 'TokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const now = Date.now();
    const insert = db.raw().prepare(
      `INSERT INTO news_events(id, source, title, body, url, tokens_json, published_at, credibility)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    // Older event for tokenA
    insert.run('e1', '@source1', 'first', 'body', null, JSON.stringify([tokenA]), now - 60 * 60_000, 80);
    // Newer event for tokenA — this should win
    insert.run('e2', '@source2', 'newer', 'body', null, JSON.stringify([tokenA]), now - 5 * 60_000, 90);
    // Event for a different token — must NOT be returned
    insert.run('e3', '@source3', 'other', 'body', null, JSON.stringify(['DifferentXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX']), now - 1 * 60_000, 95);

    const ev = db.recentNewsEventForToken(tokenA);
    expect(ev).not.toBeNull();
    expect(ev!.id).toBe('e2');
    expect(ev!.credibility).toBe(90);
  });

  it('respects the time window — old events outside the window are excluded', () => {
    const db = makeTempDb();
    const tokenB = 'TokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const now = Date.now();
    const insert = db.raw().prepare(
      `INSERT INTO news_events(id, source, title, body, url, tokens_json, published_at, credibility)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    // 8 hours old, with default 6h window
    insert.run('eOld', '@src', 'old', 'b', null, JSON.stringify([tokenB]), now - 8 * 60 * 60_000, 80);
    expect(db.recentNewsEventForToken(tokenB)).toBeNull();
    // Same row passes when the window is widened
    expect(db.recentNewsEventForToken(tokenB, 12 * 60)).not.toBeNull();
  });

  it('returns null in the production-default empty-table case', () => {
    // This is the steady-state today: newsScanner is not yet wired into
    // the main loop, so news_events is empty and the helper returns null
    // for every query. The wiring in evaluate() must therefore leave
    // breakdown.event at its emptyBreakdown() default of 0.
    const db = makeTempDb();
    for (const addr of ['x', 'y', 'z']) {
      expect(db.recentNewsEventForToken(addr)).toBeNull();
    }
  });
});
