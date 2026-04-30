/**
 * News / official-event scanner.
 *
 * Pulls posts from a curated `x_accounts` table (categories: official_project,
 * founder, news_outlet, analyst). Cross-references mentioned CAs with
 * DexScreener / Birdeye to decide VERIFIED / POSSIBLE / FAKE.
 */

import type { XAdapter } from '../adapters/x.js';
import type { DexScreenerAdapter } from '../adapters/dexscreener.js';
import type { BirdeyeAdapter } from '../adapters/birdeye.js';
import type { Db } from '../db/database.js';
import type { NewsEvent, XPostMeta } from '../types.js';

export interface NewsCandidate {
  source: { handle: string; category: string; credibility: number };
  post: XPostMeta;
  contractAddress: string;
  caOnDexScreener: boolean;
  caOnBirdeye: boolean;
  competingCAs: number;
}

export class NewsScanner {
  constructor(
    private readonly x: XAdapter,
    private readonly dex: DexScreenerAdapter,
    private readonly birdeye: BirdeyeAdapter,
    private readonly db: Db,
  ) {}

  /** Fetch latest posts from each curated x_account (basic per-account search). */
  async fetchCuratedPosts(windowMinutes = 60): Promise<NewsCandidate[]> {
    const rows = this.db
      .raw()
      .prepare(`SELECT account_id, handle, category, credibility FROM x_accounts`)
      .all() as Array<{ account_id: string; handle: string; category: string; credibility: number }>;
    const out: NewsCandidate[] = [];
    if (!this.x.isConfigured() || rows.length === 0) return out;

    const startTime = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    for (const r of rows) {
      const posts = await this.x.searchRecent({
        query: `from:${r.handle} -is:retweet`,
        maxResults: 25,
        startTime,
      });
      for (const p of posts) {
        if (!p.containedAddresses.length) continue;
        const ca = p.containedAddresses[0]!;
        const onDs = !!(await this.dex.bestSolanaPair(ca));
        const onBe = !!(await this.birdeye.tokenOverview(ca));
        out.push({
          source: { handle: r.handle, category: r.category, credibility: r.credibility },
          post: p,
          contractAddress: ca,
          caOnDexScreener: onDs,
          caOnBirdeye: onBe,
          competingCAs: p.containedAddresses.length,
        });
      }
    }
    return out;
  }

  persistEvent(ev: NewsEvent): void {
    this.db
      .raw()
      .prepare(
        `INSERT OR REPLACE INTO news_events(id, source, title, body, url, tokens_json, published_at, credibility)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        ev.id,
        ev.source,
        ev.title,
        ev.body,
        ev.url,
        JSON.stringify(ev.tokens),
        ev.publishedAt,
        ev.credibility,
      );
  }

  /**
   * Filter raw candidates to those confirmed by at least one independent
   * source (DexScreener or Birdeye), map to NewsEvents, and persist.
   * Returns the count actually persisted.
   *
   * The filter is the safety boundary between "someone tweeted a CA" and
   * "an event worth scoring": if neither DexScreener nor Birdeye knows
   * about the CA, it's most likely a fake-CA scam tweet and we drop it.
   * The downstream eventScore module independently re-checks confirmations
   * using the snapshot's own DexScreener / Birdeye fingerprints, but we
   * still want to keep `news_events` clean of obvious garbage.
   */
  persistConfirmedCandidates(candidates: NewsCandidate[]): number {
    let persisted = 0;
    for (const c of candidates) {
      if (!c.caOnDexScreener && !c.caOnBirdeye) continue;
      const ev: NewsEvent = {
        id: c.post.id,
        source: c.source.handle,
        title: c.post.text.slice(0, 80),
        body: c.post.text,
        url: null,
        tokens: [c.contractAddress],
        publishedAt: c.post.createdAt,
        credibility: c.source.credibility,
      };
      this.persistEvent(ev);
      persisted++;
    }
    return persisted;
  }

  /**
   * Single end-to-end pass: fetch curated posts, filter, persist. Returns
   * a stats object for caller logging. Short-circuits with all-zeros when
   * X is unconfigured or x_accounts is empty (caller decides whether to
   * skip the interval entirely or just no-op each tick).
   */
  async runOnce(): Promise<{ accounts: number; fetched: number; persisted: number }> {
    const row = this.db
      .raw()
      .prepare(`SELECT COUNT(*) as c FROM x_accounts`)
      .get() as { c: number };
    if (!this.x.isConfigured() || row.c === 0) {
      return { accounts: 0, fetched: 0, persisted: 0 };
    }
    const candidates = await this.fetchCuratedPosts();
    const persisted = this.persistConfirmedCandidates(candidates);
    return { accounts: row.c, fetched: candidates.length, persisted };
  }
}
