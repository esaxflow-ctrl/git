/**
 * Social scanner: queries X for cashtags, contract addresses, and curated
 * phrases. Persists posts and exposes a recent-window view per token/CA.
 */

import type { XAdapter } from '../adapters/x.js';
import type { Db } from '../db/database.js';
import type { XPostMeta } from '../types.js';

export const TRACKED_PHRASES = [
  '"official coin"',
  '"official token"',
  '"launching token"',
  '"contract address"',
  '"CA:"',
  'pumpfun',
  'Raydium',
  'Jupiter',
  'listing',
  'migration',
  '"LP added"',
];

export class SocialScanner {
  constructor(
    private readonly x: XAdapter,
    private readonly db: Db,
  ) {}

  /** Search for cashtags (e.g. $BONK), addresses, or arbitrary phrases. */
  async searchCashtag(tag: string, windowMinutes = 30): Promise<XPostMeta[]> {
    if (!this.x.isConfigured()) return [];
    const startTime = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const posts = await this.x.searchRecent({
      query: `${tag} -is:retweet lang:en`,
      maxResults: 100,
      startTime,
    });
    this.persist(posts);
    return posts;
  }

  async searchContractAddress(ca: string, windowMinutes = 30): Promise<XPostMeta[]> {
    if (!this.x.isConfigured()) return [];
    const startTime = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const posts = await this.x.searchRecent({
      query: `${ca} -is:retweet`,
      maxResults: 100,
      startTime,
    });
    this.persist(posts);
    return posts;
  }

  async searchPhrase(phrase: string, windowMinutes = 30): Promise<XPostMeta[]> {
    if (!this.x.isConfigured()) return [];
    const startTime = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const posts = await this.x.searchRecent({
      query: `${phrase} solana -is:retweet`,
      maxResults: 100,
      startTime,
    });
    this.persist(posts);
    return posts;
  }

  private persist(posts: XPostMeta[]): void {
    const stmt = this.db.raw().prepare(
      `INSERT OR IGNORE INTO social_mentions(id, source, author_id, author_handle, author_followers, author_verified,
       text, created_at, retweets, likes, quotes, replies, contained_addresses, contained_cashtags)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const tx = this.db.raw().transaction((batch: XPostMeta[]) => {
      for (const p of batch) {
        stmt.run(
          p.id,
          'x',
          p.authorId,
          p.authorHandle,
          p.authorFollowers,
          p.authorVerified ? 1 : 0,
          p.text,
          p.createdAt,
          p.retweets,
          p.likes,
          p.quotes,
          p.replies,
          JSON.stringify(p.containedAddresses),
          JSON.stringify(p.containedCashtags),
        );
      }
    });
    tx(posts);
  }
}
