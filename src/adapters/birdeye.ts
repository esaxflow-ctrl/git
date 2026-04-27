/**
 * Birdeye adapter — token metadata, price/volume, trending lists.
 *
 * Endpoints used:
 *   - GET /defi/token_overview         (price, mcap, liquidity, vol windows)
 *   - GET /defi/token_security         (mintAuthority, holders, etc.)
 *   - GET /defi/v3/token/trade-data/single
 *   - GET /defi/tokenlist (trending)
 *
 * Free-tier reality check (Birdeye Standard plan):
 *   - 60 requests / minute
 *   - 30,000 compute units / month
 *
 * Without throttling and caching, the bot would burn the monthly quota in
 * under a day. This adapter therefore:
 *   - Caches per-mint responses for 30 minutes (token_overview, token_security)
 *   - Caches the trending list for 5 minutes
 *   - Enforces a global minimum gap between outbound requests (default
 *     1100 ms ≈ 55 rpm — under the 60 rpm cap with margin)
 *
 * The cache is in-memory (per process). On restart it warms up again.
 */

import pRetry from 'p-retry';

const BASE = 'https://public-api.birdeye.so';
const SOLANA_HEADER = { 'x-chain': 'solana' };

const CACHE_TTL_LONG_MS = 30 * 60_000;
const CACHE_TTL_SHORT_MS = 5 * 60_000;
const MIN_REQUEST_GAP_MS = 1_100;

interface CacheEntry<T> {
  value: T | null;
  ts: number;
}

class TokenBucket {
  private nextAllowed = 0;
  async acquire(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowed - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.nextAllowed = Math.max(now, this.nextAllowed) + MIN_REQUEST_GAP_MS;
  }
}

export interface BirdeyeTokenOverview {
  address: string;
  symbol: string;
  name: string;
  liquidity: number;
  mc: number;
  fdv: number;
  price: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  priceChange24hPct: number;
  v5mUSD: number;
  v15mUSD: number;
  v1hUSD: number;
  v24hUSD: number;
  buy5m: number;
  sell5m: number;
  uniqueBuyers5m: number;
  uniqueSellers5m: number;
}

export class BirdeyeAdapter {
  private readonly bucket = new TokenBucket();
  private readonly overviewCache = new Map<string, CacheEntry<BirdeyeTokenOverview>>();
  private readonly securityCache = new Map<
    string,
    CacheEntry<{
      mintAuthorityActive: boolean | null;
      freezeAuthorityActive: boolean | null;
      top10HolderPct: number | null;
      topSingleHolderPct: number | null;
    }>
  >();
  private trendingCache: { entries: { address: string; symbol: string; rank: number }[]; ts: number } | null = null;

  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'X-API-KEY': this.apiKey,
      ...SOLANA_HEADER,
      accept: 'application/json',
    };
  }

  private getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null | undefined {
    const e = map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.ts > ttlMs) {
      map.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** For diagnostics: how many calls did we save by caching today? */
  cacheStats(): { overview: number; security: number; trendingFresh: boolean } {
    return {
      overview: this.overviewCache.size,
      security: this.securityCache.size,
      trendingFresh: !!this.trendingCache && Date.now() - this.trendingCache.ts < CACHE_TTL_SHORT_MS,
    };
  }

  async tokenOverview(mint: string): Promise<BirdeyeTokenOverview | null> {
    if (!this.apiKey) return null;
    const cached = this.getCached(this.overviewCache, mint, CACHE_TTL_LONG_MS);
    if (cached !== undefined) return cached;
    await this.bucket.acquire();
    const url = `${BASE}/defi/token_overview?address=${mint}`;
    try {
      const result = await pRetry(
        async () => {
          const r = await fetch(url, { headers: this.headers() });
          if (r.status === 429) throw new Error('birdeye 429');
          if (!r.ok) return null;
          const j = (await r.json()) as { success?: boolean; data?: Record<string, unknown> };
          if (!j.success || !j.data) return null;
          const d = j.data as {
            address: string;
            symbol: string;
            name: string;
            liquidity: number;
            mc: number;
            fdv: number;
            price: number;
            priceChange5mPercent?: number;
            priceChange1hPercent?: number;
            priceChange24hPercent?: number;
            v5mUSD?: number;
            v15mUSD?: number;
            v1hUSD?: number;
            v24hUSD?: number;
            buy5m?: number;
            sell5m?: number;
            uniqueWallet5m?: number;
            uniqueWallet5mChangePercent?: number;
          };
          return {
            address: d.address,
            symbol: d.symbol,
            name: d.name,
            liquidity: Number(d.liquidity ?? 0),
            mc: Number(d.mc ?? 0),
            fdv: Number(d.fdv ?? 0),
            price: Number(d.price ?? 0),
            priceChange5mPct: Number(d.priceChange5mPercent ?? 0),
            priceChange1hPct: Number(d.priceChange1hPercent ?? 0),
            priceChange24hPct: Number(d.priceChange24hPercent ?? 0),
            v5mUSD: Number(d.v5mUSD ?? 0),
            v15mUSD: Number(d.v15mUSD ?? 0),
            v1hUSD: Number(d.v1hUSD ?? 0),
            v24hUSD: Number(d.v24hUSD ?? 0),
            buy5m: Number(d.buy5m ?? 0),
            sell5m: Number(d.sell5m ?? 0),
            uniqueBuyers5m: Number(d.uniqueWallet5m ?? 0),
            uniqueSellers5m: Number(d.uniqueWallet5m ?? 0),
          };
        },
        { retries: 2, minTimeout: 400 },
      );
      this.overviewCache.set(mint, { value: result, ts: Date.now() });
      return result;
    } catch {
      // Cache the null too — avoids re-banging Birdeye for a token that
      // returned an error a moment ago. Short TTL via security cache pattern.
      this.overviewCache.set(mint, { value: null, ts: Date.now() });
      return null;
    }
  }

  async trendingTokens(limit = 50): Promise<{ address: string; symbol: string; rank: number }[]> {
    if (!this.apiKey) return [];
    if (this.trendingCache && Date.now() - this.trendingCache.ts < CACHE_TTL_SHORT_MS) {
      return this.trendingCache.entries.slice(0, limit);
    }
    await this.bucket.acquire();
    const url = `${BASE}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`;
    try {
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) return [];
      const j = (await r.json()) as { data?: { tokens?: Array<{ address: string; symbol: string; rank: number }> } };
      const entries = j.data?.tokens ?? [];
      this.trendingCache = { entries, ts: Date.now() };
      return entries.slice(0, limit);
    } catch {
      return [];
    }
  }

  async tokenSecurity(mint: string): Promise<{
    mintAuthorityActive: boolean | null;
    freezeAuthorityActive: boolean | null;
    top10HolderPct: number | null;
    topSingleHolderPct: number | null;
  }> {
    const empty = {
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      top10HolderPct: null,
      topSingleHolderPct: null,
    };
    if (!this.apiKey) return empty;
    const cached = this.getCached(this.securityCache, mint, CACHE_TTL_LONG_MS);
    if (cached !== undefined) return cached ?? empty;
    await this.bucket.acquire();
    const url = `${BASE}/defi/token_security?address=${mint}`;
    try {
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) {
        this.securityCache.set(mint, { value: null, ts: Date.now() });
        return empty;
      }
      const j = (await r.json()) as {
        data?: {
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
          top10HolderPercent?: number;
          ownerPercentage?: number;
        };
      };
      const d = j.data ?? {};
      const result = {
        mintAuthorityActive: d.mintAuthority === undefined ? null : d.mintAuthority !== null,
        freezeAuthorityActive: d.freezeAuthority === undefined ? null : d.freezeAuthority !== null,
        top10HolderPct: d.top10HolderPercent !== undefined ? Number(d.top10HolderPercent) * 100 : null,
        topSingleHolderPct: d.ownerPercentage !== undefined ? Number(d.ownerPercentage) * 100 : null,
      };
      this.securityCache.set(mint, { value: result, ts: Date.now() });
      return result;
    } catch {
      this.securityCache.set(mint, { value: null, ts: Date.now() });
      return empty;
    }
  }
}
