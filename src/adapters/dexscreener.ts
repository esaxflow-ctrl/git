/**
 * DexScreener adapter — pair / token search, profiles, boosts.
 *
 * DexScreener has a public free tier (no key needed). The "paid orders /
 * boosts" endpoints are public read endpoints.
 *
 * Endpoints:
 *   GET https://api.dexscreener.com/latest/dex/tokens/{address}
 *   GET https://api.dexscreener.com/latest/dex/search?q={query}
 *   GET https://api.dexscreener.com/token-profiles/latest/v1
 *   GET https://api.dexscreener.com/token-boosts/latest/v1
 *   GET https://api.dexscreener.com/token-boosts/top/v1
 *   GET https://api.dexscreener.com/orders/v1/solana/{tokenAddress}
 */

const BASE = 'https://api.dexscreener.com';

export interface DsPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string | undefined;
  priceChange: { m5?: number; h1?: number; h24?: number };
  volume: { m5?: number; h1?: number; h24?: number };
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  liquidity: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export interface DsTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  description?: string;
  links?: { type: string; url: string }[];
}

export interface DsBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  description?: string;
}

export class DexScreenerAdapter {
  // apiKey is currently unused (DexScreener public endpoints are open) but
  // is reserved for future paid-tier endpoints.
  constructor(_apiKey?: string) {}

  async getPairsByToken(address: string): Promise<DsPair[]> {
    try {
      const r = await fetch(`${BASE}/latest/dex/tokens/${address}`);
      if (!r.ok) return [];
      const j = (await r.json()) as { pairs?: DsPair[] };
      return j.pairs ?? [];
    } catch {
      return [];
    }
  }

  /** Best Solana pair by USD liquidity. */
  async bestSolanaPair(address: string): Promise<DsPair | null> {
    const pairs = await this.getPairsByToken(address);
    const sol = pairs.filter((p) => p.chainId === 'solana');
    if (!sol.length) return null;
    return sol.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
  }

  async search(query: string): Promise<DsPair[]> {
    try {
      const r = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) return [];
      const j = (await r.json()) as { pairs?: DsPair[] };
      return (j.pairs ?? []).filter((p) => p.chainId === 'solana');
    } catch {
      return [];
    }
  }

  async latestTokenProfiles(): Promise<DsTokenProfile[]> {
    try {
      const r = await fetch(`${BASE}/token-profiles/latest/v1`);
      if (!r.ok) return [];
      const j = (await r.json()) as DsTokenProfile[];
      return j.filter((t) => t.chainId === 'solana');
    } catch {
      return [];
    }
  }

  async latestBoosts(): Promise<DsBoost[]> {
    try {
      const r = await fetch(`${BASE}/token-boosts/latest/v1`);
      if (!r.ok) return [];
      const j = (await r.json()) as DsBoost[];
      return j.filter((b) => b.chainId === 'solana');
    } catch {
      return [];
    }
  }

  async topBoosts(): Promise<DsBoost[]> {
    try {
      const r = await fetch(`${BASE}/token-boosts/top/v1`);
      if (!r.ok) return [];
      const j = (await r.json()) as DsBoost[];
      return j.filter((b) => b.chainId === 'solana');
    } catch {
      return [];
    }
  }

  async paidOrders(tokenAddress: string): Promise<unknown[]> {
    try {
      const r = await fetch(`${BASE}/orders/v1/solana/${tokenAddress}`);
      if (!r.ok) return [];
      return (await r.json()) as unknown[];
    } catch {
      return [];
    }
  }
}
