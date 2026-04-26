/**
 * Migration scanner: detects tokens that recently moved from a bonding-curve
 * launchpad to a real DEX (Raydium / PumpSwap / Orca / Meteora) and have a
 * fresh Jupiter route.
 *
 * Approach: query DexScreener for the token's pairs and check whether a
 * non-curve pair appears whose `pairCreatedAt` is within a recent window.
 */

import type { TokenSnapshot } from '../types.js';
import type { DexScreenerAdapter } from '../adapters/dexscreener.js';
import { snapshotFromPair } from './newTokenScanner.js';
import type { ScannerDeps } from './newTokenScanner.js';

export interface MigrationCandidate {
  snapshot: TokenSnapshot;
  fromVenue: string;
  toVenue: string;
  migrationDetectedAt: number;
}

export async function scanMigrations(
  deps: ScannerDeps,
  dex: DexScreenerAdapter,
  withinMinutes = 60,
  limit = 25,
): Promise<MigrationCandidate[]> {
  const profiles = await dex.latestTokenProfiles();
  const out: MigrationCandidate[] = [];
  const cutoff = Date.now() - withinMinutes * 60_000;

  for (const p of profiles.slice(0, limit)) {
    const pairs = await dex.getPairsByToken(p.tokenAddress);
    const sol = pairs.filter((pp) => pp.chainId === 'solana');
    if (sol.length < 2) continue; // need >= 2 pairs to suggest migration

    const curve = sol.find((pp) => pp.dexId.toLowerCase().includes('pump.fun'));
    const dexPair = sol
      .filter((pp) => !pp.dexId.toLowerCase().includes('pump.fun'))
      .sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0))[0];

    if (!curve || !dexPair) continue;
    const created = dexPair.pairCreatedAt ?? 0;
    if (created < cutoff) continue;

    const snap = await snapshotFromPair(deps, dexPair);
    out.push({
      snapshot: snap,
      fromVenue: curve.dexId,
      toVenue: dexPair.dexId,
      migrationDetectedAt: created,
    });
  }
  return out;
}
