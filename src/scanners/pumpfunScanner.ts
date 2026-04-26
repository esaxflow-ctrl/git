/**
 * Pump.fun-style launchpad scanner.
 *
 * NOTE: Pump.fun runs as on-chain programs whose layout shifts over time.
 * This scanner uses *public, observable* signals (DexScreener tags, Helius
 * enhanced tx parsing, mint creation events) to identify launchpad-style
 * tokens. Precise bonding-curve progress should be parsed via the current
 * pump.fun program — that requires a tested IDL and is left as a clearly
 * marked extension point.
 */

import type { DexScreenerAdapter } from '../adapters/dexscreener.js';
import type { ScannerDeps } from './newTokenScanner.js';
import { snapshotFromPair } from './newTokenScanner.js';
import type { TokenSnapshot } from '../types.js';

export interface PumpfunCandidate {
  snapshot: TokenSnapshot;
  curveProgressPct: number | null;       // null when unknown — the strategy
                                         // must treat null as "unknown", not "complete"
  estUniqueBuyers: number;
  earlyHolderConcentrationPct: number | null;
}

export async function scanPumpfun(
  deps: ScannerDeps,
  dex: DexScreenerAdapter,
  limit = 30,
): Promise<PumpfunCandidate[]> {
  const profiles = await dex.latestTokenProfiles();
  const out: PumpfunCandidate[] = [];

  for (const p of profiles.slice(0, limit)) {
    const pair = await dex.bestSolanaPair(p.tokenAddress);
    if (!pair) continue;

    // Treat pump.fun-curve dexId as launchpad. Migrated pairs land on
    // raydium/pumpswap and are picked up by migrationScanner instead.
    const isCurve = pair.dexId.toLowerCase().includes('pump');
    if (!isCurve) continue;

    const snap = await snapshotFromPair(deps, pair);

    // We don't parse the live curve here. Holder concentration + age give
    // a reasonable proxy for "how early" we are.
    out.push({
      snapshot: snap,
      curveProgressPct: null,
      estUniqueBuyers: snap.uniqueBuyers5m,
      earlyHolderConcentrationPct: snap.top10HolderPct,
    });
  }
  return out;
}
