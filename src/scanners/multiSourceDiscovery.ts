/**
 * Multi-source discovery — combines:
 *   - DexScreener latest token profiles (organic + paid profiles)
 *   - Birdeye trending tokens (real volume / movers)
 *   - Migration scanner (recently graduated launchpad tokens)
 *
 * Dedupes by mint address. Returns a single TokenSnapshot[] for the main
 * loop to score. Each snapshot is tagged with the source(s) that surfaced it.
 */

import type { BirdeyeAdapter } from '../adapters/birdeye.js';
import type { DexScreenerAdapter } from '../adapters/dexscreener.js';
import type { HeliusAdapter } from '../adapters/helius.js';
import type { JupiterAdapter } from '../adapters/jupiter.js';
import { snapshotFromPair } from './newTokenScanner.js';
import { scanMigrations } from './migrationScanner.js';
import type { TokenSnapshot } from '../types.js';

export interface MultiSourceDeps {
  dex: DexScreenerAdapter;
  birdeye: BirdeyeAdapter;
  helius: HeliusAdapter;
  jupiter: JupiterAdapter;
}

export type DiscoverySource = 'ds_latest_profile' | 'birdeye_trending' | 'migration' | 'ds_boost';

export interface DiscoveredToken {
  snapshot: TokenSnapshot;
  sources: DiscoverySource[];
}

export interface MultiSourceLimits {
  perSourceLimit: number;
  totalLimit: number;
}

const DEFAULT_LIMITS: MultiSourceLimits = { perSourceLimit: 25, totalLimit: 60 };

export async function discoverMultiSource(
  deps: MultiSourceDeps,
  limits: Partial<MultiSourceLimits> = {},
): Promise<DiscoveredToken[]> {
  const { perSourceLimit, totalLimit } = { ...DEFAULT_LIMITS, ...limits };

  // --- 1. Gather mint addresses + a known DEX pair when available ---------
  const sources = new Map<string, { sources: Set<DiscoverySource>; pairAddr?: string }>();

  // Source A: DexScreener latest profiles (mostly fresh launches, lots of spam).
  try {
    const profiles = await deps.dex.latestTokenProfiles();
    for (const p of profiles.slice(0, perSourceLimit)) {
      addSource(sources, p.tokenAddress, 'ds_latest_profile');
    }
  } catch {
    /* swallow per-source */
  }

  // Source B: Birdeye trending tokens (volume-weighted ranks, far less spam).
  try {
    const trending = await deps.birdeye.trendingTokens(perSourceLimit);
    for (const t of trending) addSource(sources, t.address, 'birdeye_trending');
  } catch {
    /* swallow */
  }

  // Source C: DexScreener boosted tokens (paid placements — confirm via vol).
  try {
    const boosts = await deps.dex.topBoosts();
    for (const b of boosts.slice(0, Math.min(perSourceLimit, 15))) {
      addSource(sources, b.tokenAddress, 'ds_boost');
    }
  } catch {
    /* swallow */
  }

  // Source D: Migration scanner (already returns enriched candidates).
  let migrations: Awaited<ReturnType<typeof scanMigrations>> = [];
  try {
    migrations = await scanMigrations(deps, deps.dex, 60, Math.min(perSourceLimit, 15));
    for (const m of migrations) {
      addSource(sources, m.snapshot.address, 'migration');
    }
  } catch {
    /* swallow */
  }

  // --- 2. Build snapshots, preferring already-built migration snapshots ----
  const migrationByAddr = new Map(migrations.map((m) => [m.snapshot.address, m.snapshot]));

  const out: DiscoveredToken[] = [];
  let processed = 0;
  for (const [mint, info] of sources.entries()) {
    if (processed >= totalLimit) break;
    processed++;

    const cached = migrationByAddr.get(mint);
    if (cached) {
      out.push({ snapshot: cached, sources: Array.from(info.sources) });
      continue;
    }

    try {
      const pair = await deps.dex.bestSolanaPair(mint);
      if (!pair) continue;
      const snap = await snapshotFromPair(deps, pair);
      out.push({ snapshot: snap, sources: Array.from(info.sources) });
    } catch {
      /* per-token failures are normal; skip and continue */
    }
  }
  return out;
}

function addSource(
  m: Map<string, { sources: Set<DiscoverySource>; pairAddr?: string }>,
  addr: string,
  src: DiscoverySource,
): void {
  const existing = m.get(addr);
  if (existing) existing.sources.add(src);
  else m.set(addr, { sources: new Set([src]) });
}
