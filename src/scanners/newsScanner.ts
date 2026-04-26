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
}
