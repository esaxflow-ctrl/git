/**
 * New token scanner: combine DexScreener latest token profiles + Birdeye
 * trending + Jupiter route check into a deduped TokenSnapshot[] for the
 * pipeline.
 *
 * The scanner does NOT decide trades. It only enriches.
 */

import type { BirdeyeAdapter } from '../adapters/birdeye.js';
import type { DexScreenerAdapter, DsPair } from '../adapters/dexscreener.js';
import type { HeliusAdapter } from '../adapters/helius.js';
import type { JupiterAdapter } from '../adapters/jupiter.js';
import { SOL_MINT_ADDRESS } from '../adapters/jupiter.js';
import type { DexId, TokenSnapshot } from '../types.js';

export interface ScannerDeps {
  dex: DexScreenerAdapter;
  birdeye: BirdeyeAdapter;
  helius: HeliusAdapter;
  jupiter: JupiterAdapter;
}

function dexIdOf(s: string): DexId {
  const x = s.toLowerCase();
  if (x.includes('raydium')) return 'raydium';
  if (x.includes('pumpswap')) return 'pumpswap';
  if (x.includes('orca')) return 'orca';
  if (x.includes('meteora')) return 'meteora';
  if (x.includes('pump.fun') || x.includes('pumpfun')) return 'pump_fun_curve';
  return 'unknown';
}

export async function snapshotFromPair(
  deps: ScannerDeps,
  pair: DsPair,
  now: number = Date.now(),
): Promise<TokenSnapshot> {
  const mint = pair.baseToken.address;
  const liq = pair.liquidity?.usd ?? 0;

  // Jupiter route check (1 SOL probe).
  const quote = await deps.jupiter.getQuote({
    inputMint: SOL_MINT_ADDRESS,
    outputMint: mint,
    amount: '1000000000',
    slippageBps: 300,
  });
  const jupiterAvailable = !!quote && quote.routePlan.length > 0;
  const priceImpact = quote?.priceImpactPct ?? null;
  const slippageBps = quote?.slippageBps ?? null;

  const security = await deps.birdeye.tokenSecurity(mint).catch(() => null);
  let top10HolderPct: number | null;
  let topSingleHolderPct: number | null;
  if (security) {
    top10HolderPct = security.top10HolderPct;
    topSingleHolderPct = security.topSingleHolderPct;
  } else {
    const h = await deps.helius.getHolderConcentration(mint);
    top10HolderPct = h.top10Pct;
    topSingleHolderPct = h.topSinglePct;
  }
  const auth = security
    ? { mintAuthorityActive: security.mintAuthorityActive, freezeAuthorityActive: security.freezeAuthorityActive }
    : await deps.helius.getMintAuthorityStatus(mint);

  const poolAgeMin = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / 60_000 : 0;

  return {
    address: mint,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    pairAddress: pair.pairAddress,
    dex: dexIdOf(pair.dexId),
    liquidityUsd: liq,
    marketCapUsd: pair.marketCap ?? 0,
    fdvUsd: pair.fdv ?? 0,
    priceUsd: Number(pair.priceUsd ?? 0),
    priceChange5mPct: pair.priceChange?.m5 ?? 0,
    priceChange1hPct: pair.priceChange?.h1 ?? 0,
    priceChange24hPct: pair.priceChange?.h24 ?? 0,
    volume5mUsd: pair.volume?.m5 ?? 0,
    volume15mUsd: 0,
    volume1hUsd: pair.volume?.h1 ?? 0,
    volume24hUsd: pair.volume?.h24 ?? 0,
    buyCount5m: pair.txns?.m5?.buys ?? 0,
    sellCount5m: pair.txns?.m5?.sells ?? 0,
    uniqueBuyers5m: pair.txns?.m5?.buys ?? 0,    // dexscreener doesn't return uniques; approximate
    uniqueSellers5m: pair.txns?.m5?.sells ?? 0,
    tokenAgeMinutes: poolAgeMin,
    poolAgeMinutes: poolAgeMin,
    jupiterQuoteAvailable: jupiterAvailable,
    estPriceImpactPct: priceImpact,
    estSlippageBps: slippageBps,
    mintAuthorityActive: auth.mintAuthorityActive,
    freezeAuthorityActive: auth.freezeAuthorityActive,
    top10HolderPct,
    topSingleHolderPct,
    fetchedAt: now,
  };
}

export async function scanNewTokens(deps: ScannerDeps, limit = 30): Promise<TokenSnapshot[]> {
  const profiles = await deps.dex.latestTokenProfiles();
  const targets = profiles.slice(0, limit);
  const out: TokenSnapshot[] = [];
  for (const t of targets) {
    const pair = await deps.dex.bestSolanaPair(t.tokenAddress);
    if (!pair) continue;
    out.push(await snapshotFromPair(deps, pair));
  }
  return out;
}
