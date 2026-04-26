/**
 * Birdeye adapter — token metadata, price/volume, trending lists.
 *
 * Endpoints used:
 *   - GET /defi/token_overview         (price, mcap, liquidity, vol windows)
 *   - GET /defi/token_security         (mintAuthority, holders, etc.)
 *   - GET /defi/v3/token/trade-data/single
 *   - GET /defi/tokenlist (trending)
 *
 * The free tier is rate-limited; we assume an API key. Rate-limit aware.
 */

import pRetry from 'p-retry';

const BASE = 'https://public-api.birdeye.so';
const SOLANA_HEADER = { 'x-chain': 'solana' };

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
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'X-API-KEY': this.apiKey,
      ...SOLANA_HEADER,
      accept: 'application/json',
    };
  }

  async tokenOverview(mint: string): Promise<BirdeyeTokenOverview | null> {
    if (!this.apiKey) return null;
    const url = `${BASE}/defi/token_overview?address=${mint}`;
    try {
      return await pRetry(
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
    } catch {
      return null;
    }
  }

  async trendingTokens(limit = 50): Promise<{ address: string; symbol: string; rank: number }[]> {
    if (!this.apiKey) return [];
    const url = `${BASE}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`;
    try {
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) return [];
      const j = (await r.json()) as { data?: { tokens?: Array<{ address: string; symbol: string; rank: number }> } };
      return j.data?.tokens ?? [];
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
    if (!this.apiKey) {
      return {
        mintAuthorityActive: null,
        freezeAuthorityActive: null,
        top10HolderPct: null,
        topSingleHolderPct: null,
      };
    }
    const url = `${BASE}/defi/token_security?address=${mint}`;
    try {
      const r = await fetch(url, { headers: this.headers() });
      if (!r.ok) {
        return {
          mintAuthorityActive: null,
          freezeAuthorityActive: null,
          top10HolderPct: null,
          topSingleHolderPct: null,
        };
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
      return {
        mintAuthorityActive: d.mintAuthority === undefined ? null : d.mintAuthority !== null,
        freezeAuthorityActive: d.freezeAuthority === undefined ? null : d.freezeAuthority !== null,
        top10HolderPct: d.top10HolderPercent !== undefined ? Number(d.top10HolderPercent) * 100 : null,
        topSingleHolderPct: d.ownerPercentage !== undefined ? Number(d.ownerPercentage) * 100 : null,
      };
    } catch {
      return {
        mintAuthorityActive: null,
        freezeAuthorityActive: null,
        top10HolderPct: null,
        topSingleHolderPct: null,
      };
    }
  }
}
