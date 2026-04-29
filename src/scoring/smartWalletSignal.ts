/**
 * Smart-wallet confirmation score.
 *
 * Turns a list of recent watched-wallet buys on a single token into a 0-100
 * sub-score plus a "cluster" sub-score. The cluster fires when 2+ wallets
 * bought independently within a short window — that's much harder to fake
 * than a single wallet entry and is the core signal behind copy-trading
 * systems.
 *
 * The two scores are deliberately separate: `smartWallet` rewards quality
 * of any single buyer (their PnL track record), `smartWalletCluster`
 * rewards breadth (multiple independent buyers).
 */

import type { WatchedWallet } from '../types.js';

export interface RecentBuy {
  wallet: WatchedWallet;
  blockTime: number;
}

export interface SmartWalletScores {
  smartWallet: number;        // 0-100 — best single buyer quality
  smartWalletCluster: number; // 0-100 — breadth of independent buys
  notes: string[];            // human-readable confirmations
  count: number;              // how many recent buys
}

const LABEL_WEIGHT: Record<string, number> = {
  ELITE_COPYABLE: 1.0,
  GOOD_BUT_RISKY: 0.7,
  INSIDER_LIKELY: 0.0, // dev/insider — never copy
  DEV_WALLET_LIKELY: 0.0,
  SNIPER_BOT: 0.0,
  TOO_FAST_TO_COPY: 0.0,
  LOW_QUALITY: 0.0,
  IGNORE: 0.0,
};

/**
 * Score recent watched-wallet buys for a single token.
 *
 * - Single-wallet score = best individual wallet's score, multiplied by
 *   their label weight (only ELITE/GOOD label types count).
 * - Cluster score scales with the number of independent quality buyers,
 *   capped at 100. Two ELITE buyers in <30 min ≈ 90.
 * - Stale buys (>2h) are decayed linearly to 0 at 6h.
 */
export function scoreSmartWalletBuys(
  buys: RecentBuy[],
  now: number = Date.now(),
): SmartWalletScores {
  const notes: string[] = [];
  if (buys.length === 0) {
    return { smartWallet: 0, smartWalletCluster: 0, notes, count: 0 };
  }

  // Decay weight by recency: full credit ≤ 30 min, linear decay to 0 at 6h.
  const weighted = buys.map((b) => {
    const ageMin = Math.max(0, (now - b.blockTime) / 60_000);
    const recency =
      ageMin <= 30 ? 1.0 : ageMin >= 360 ? 0 : 1 - (ageMin - 30) / (360 - 30);
    const labelWeight = LABEL_WEIGHT[b.wallet.label] ?? 0;
    const adjScore = b.wallet.score * labelWeight * recency;
    return { ...b, recency, labelWeight, adjScore };
  });

  const qualityBuyers = weighted.filter((w) => w.adjScore > 0);
  if (qualityBuyers.length === 0) {
    return { smartWallet: 0, smartWalletCluster: 0, notes, count: 0 };
  }

  // Single-wallet: best buyer's adjusted score.
  const best = qualityBuyers.reduce((a, b) => (b.adjScore > a.adjScore ? b : a));
  const smartWallet = Math.round(Math.min(100, best.adjScore));
  notes.push(
    `${best.wallet.label} wallet ${short(best.wallet.address)} (score ${best.wallet.score}) bought ${minutesAgo(best.blockTime, now)} ago`,
  );

  // Cluster: sum of unique-wallet adjusted scores, but with a diminishing
  // return so a single big wallet can't fake a cluster signal. We give
  // 60 base for first quality wallet, +25 for second, +15 for third+.
  const uniqueAddrs = new Set<string>();
  let cluster = 0;
  let added = 0;
  for (const w of qualityBuyers.sort((a, b) => b.adjScore - a.adjScore)) {
    if (uniqueAddrs.has(w.wallet.address)) continue;
    uniqueAddrs.add(w.wallet.address);
    const labelMul = w.labelWeight;
    if (added === 0) cluster += 60 * labelMul * w.recency;
    else if (added === 1) cluster += 25 * labelMul * w.recency;
    else cluster += 15 * labelMul * w.recency;
    added++;
    if (added >= 5) break;
  }
  const smartWalletCluster = Math.round(Math.min(100, cluster));

  if (uniqueAddrs.size >= 2) {
    notes.push(`${uniqueAddrs.size} independent watched wallets bought recently`);
  }

  return {
    smartWallet,
    smartWalletCluster,
    notes,
    count: uniqueAddrs.size,
  };
}

function short(addr: string): string {
  if (addr.length < 10) return addr;
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function minutesAgo(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}
