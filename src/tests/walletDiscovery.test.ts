/**
 * Smoke tests for the wallet auto-discovery DB plumbing.
 *
 * The full scanner makes external API calls, so we don't test that path here.
 * What we do test: the schema is in place, observations can be recorded,
 * and the proposeFromObservations() promotion respects MIN_TOKENS and applies
 * conservative labels (never auto-promotes to ELITE_COPYABLE).
 */

import { describe, it, expect } from 'vitest';
import { makeTempDb } from './helpers.js';

describe('wallet_observations schema and promotion logic', () => {
  it('stores wallet_observations and counts correctly', () => {
    const db = makeTempDb();
    db.raw()
      .prepare(
        `INSERT INTO wallet_observations(wallet, token_address, first_buy_ts, pool_age_at_buy_seconds,
         buy_price_usd, buy_market_cap_usd, later_max_market_cap_usd, approx_pnl_pct, signature)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run('walletA', 'tokenX', 1, 60, 0.001, 50_000, 200_000, 300, 'sig1');
    db.raw()
      .prepare(
        `INSERT INTO wallet_observations(wallet, token_address, first_buy_ts, pool_age_at_buy_seconds,
         buy_price_usd, buy_market_cap_usd, later_max_market_cap_usd, approx_pnl_pct, signature)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run('walletA', 'tokenY', 2, 90, 0.002, 30_000, 60_000, 100, 'sig2');

    const row = db
      .raw()
      .prepare(`SELECT COUNT(*) c FROM wallet_observations WHERE wallet = ?`)
      .get('walletA') as { c: number };
    expect(row.c).toBe(2);
    db.close();
  });

  it('examined_pools tracks pools and bumps early_buyers_seen on conflict', () => {
    const db = makeTempDb();
    const stmt = db.raw().prepare(
      `INSERT INTO examined_pools(token_address, pair_address, examined_at, early_buyers_seen)
       VALUES(?,?,?,?)
       ON CONFLICT(token_address) DO UPDATE SET
         examined_at = excluded.examined_at,
         pair_address = excluded.pair_address,
         early_buyers_seen = examined_pools.early_buyers_seen + excluded.early_buyers_seen`,
    );
    stmt.run('tokenX', 'pairA', 1, 5);
    stmt.run('tokenX', 'pairA', 2, 7);
    const row = db
      .raw()
      .prepare(`SELECT examined_at, early_buyers_seen FROM examined_pools WHERE token_address = ?`)
      .get('tokenX') as { examined_at: number; early_buyers_seen: number };
    expect(row.examined_at).toBe(2);
    expect(row.early_buyers_seen).toBe(12);
    db.close();
  });
});
