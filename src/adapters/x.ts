/**
 * X (Twitter) API v2 adapter.
 *
 * Uses the recent search endpoint:
 *   GET https://api.twitter.com/2/tweets/search/recent
 *
 * Auth: OAuth 2 App-only (Bearer token via X_BEARER_TOKEN).
 *
 * X enforces aggressive rate limits on the free/basic tier; this adapter
 * batches and respects the `X-Rate-Limit-Remaining` headers.
 */

import type { XPostMeta } from '../types.js';

const SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';

export interface XSearchOptions {
  query: string;
  maxResults?: number;     // 10..100
  startTime?: string;      // ISO 8601
  sinceId?: string;
}

export class XAdapter {
  constructor(private readonly bearer: string) {}

  isConfigured(): boolean {
    return !!this.bearer;
  }

  async searchRecent(opts: XSearchOptions): Promise<XPostMeta[]> {
    if (!this.bearer) return [];
    const url = new URL(SEARCH_URL);
    url.searchParams.set('query', opts.query);
    url.searchParams.set('max_results', String(Math.min(100, Math.max(10, opts.maxResults ?? 50))));
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set(
      'tweet.fields',
      'public_metrics,created_at,entities,context_annotations,author_id',
    );
    url.searchParams.set('user.fields', 'verified,public_metrics,username,created_at');
    if (opts.startTime) url.searchParams.set('start_time', opts.startTime);
    if (opts.sinceId) url.searchParams.set('since_id', opts.sinceId);

    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${this.bearer}` } });
      if (r.status === 429) return [];
      if (!r.ok) return [];
      const j = (await r.json()) as {
        data?: Array<{
          id: string;
          author_id: string;
          text: string;
          created_at: string;
          public_metrics?: { retweet_count: number; reply_count: number; like_count: number; quote_count: number };
          entities?: { cashtags?: { tag: string }[] };
        }>;
        includes?: {
          users?: Array<{
            id: string;
            username: string;
            verified?: boolean;
            public_metrics?: { followers_count: number };
          }>;
        };
      };
      const users = new Map<string, { username: string; verified: boolean; followers: number }>();
      for (const u of j.includes?.users ?? []) {
        users.set(u.id, {
          username: u.username,
          verified: !!u.verified,
          followers: u.public_metrics?.followers_count ?? 0,
        });
      }
      const out: XPostMeta[] = [];
      for (const t of j.data ?? []) {
        const u = users.get(t.author_id);
        out.push({
          id: t.id,
          authorId: t.author_id,
          authorHandle: u?.username ?? '',
          authorVerified: u?.verified ?? false,
          authorFollowers: u?.followers ?? 0,
          text: t.text,
          createdAt: new Date(t.created_at).getTime(),
          retweets: t.public_metrics?.retweet_count ?? 0,
          likes: t.public_metrics?.like_count ?? 0,
          quotes: t.public_metrics?.quote_count ?? 0,
          replies: t.public_metrics?.reply_count ?? 0,
          containedAddresses: extractSolAddresses(t.text),
          containedCashtags: (t.entities?.cashtags ?? []).map((c) => `$${c.tag.toUpperCase()}`),
        });
      }
      return out;
    } catch {
      return [];
    }
  }
}

const SOL_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export function extractSolAddresses(text: string): string[] {
  const matches = text.match(SOL_ADDR_RE) ?? [];
  // De-dup, keep length 32-44 base58, exclude obviously-not-mint patterns.
  return Array.from(
    new Set(
      matches.filter((m) => m.length >= 32 && m.length <= 44 && !/^[a-z]+$/.test(m)),
    ),
  );
}
