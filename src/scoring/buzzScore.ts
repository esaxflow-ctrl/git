/**
 * Buzz score (0–100) over a recent window of X posts mentioning a token.
 *
 * Inputs are already filtered to be relevant (CA match or cashtag match).
 * The score weighs:
 *   - mention velocity (count over window)
 *   - engagement velocity (likes+rt+quote)
 *   - unique-author count
 *   - high-follower / verified author share
 *   - duplicate-spam ratio (very similar text)
 *   - bot-like ratio (tiny accounts, similar timing)
 *
 * Buzz alone never permits a live buy — see masterSignalScore.
 */

import type { BuzzSignalType, XPostMeta } from '../types.js';

export interface BuzzInputs {
  posts: XPostMeta[];
  windowMinutes: number;
  /** Optional CA the buzz centres on; used to detect "fake CA" risk. */
  contractAddress?: string;
  /** Optional list of "official" account ids/handles to weight heavily. */
  officialHandles?: Set<string>;
  /** Optional list of credible (curated) account ids to weight up. */
  credibleHandles?: Set<string>;
}

export interface BuzzResult {
  score: number;
  signalType: BuzzSignalType;
  breakdown: {
    posts: number;
    uniqueAuthors: number;
    verifiedShare: number;
    highFollowerShare: number;
    spamShare: number;
    botShare: number;
    engagement: number;
    officialMentions: number;
    credibleMentions: number;
    distinctCAs: number;
  };
  reasons: string[];
}

export function scoreBuzz(input: BuzzInputs): BuzzResult {
  const reasons: string[] = [];
  const posts = input.posts;
  const n = posts.length;

  const uniqueAuthors = new Set(posts.map((p) => p.authorId)).size;
  const verified = posts.filter((p) => p.authorVerified).length;
  const highFollowers = posts.filter((p) => p.authorFollowers >= 10_000).length;
  const officialMentions = input.officialHandles
    ? posts.filter((p) => input.officialHandles!.has(p.authorHandle.toLowerCase())).length
    : 0;
  const credibleMentions = input.credibleHandles
    ? posts.filter((p) => input.credibleHandles!.has(p.authorHandle.toLowerCase())).length
    : 0;

  // Spam / bot heuristics.
  const textCounts = new Map<string, number>();
  for (const p of posts) {
    const norm = p.text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
    textCounts.set(norm, (textCounts.get(norm) ?? 0) + 1);
  }
  const dupes = Array.from(textCounts.values()).reduce((s, c) => s + (c > 1 ? c : 0), 0);
  const botLike = posts.filter((p) => p.authorFollowers < 50 && p.likes < 1).length;

  // Engagement.
  const engagement = posts.reduce((s, p) => s + p.likes + p.retweets + p.replies + p.quotes, 0);

  // CA-confusion risk.
  const caSet = new Set(posts.flatMap((p) => p.containedAddresses));
  const distinctCAs = caSet.size;

  let score = 0;

  // Mention velocity (cap by window)
  const perMin = n / Math.max(1, input.windowMinutes);
  if (perMin >= 5) score += 25;
  else if (perMin >= 2) score += 18;
  else if (perMin >= 1) score += 12;
  else if (perMin >= 0.5) score += 6;

  // Unique authors
  if (uniqueAuthors >= 50) score += 20;
  else if (uniqueAuthors >= 20) score += 12;
  else if (uniqueAuthors >= 10) score += 6;

  // Engagement velocity
  if (engagement / Math.max(1, n) >= 100) score += 15;
  else if (engagement / Math.max(1, n) >= 25) score += 10;
  else if (engagement / Math.max(1, n) >= 5) score += 5;

  // Credible / verified weighting
  const verifiedShare = n > 0 ? verified / n : 0;
  const highFollowerShare = n > 0 ? highFollowers / n : 0;
  if (verifiedShare > 0.1) score += 10;
  if (highFollowerShare > 0.2) score += 10;
  if (officialMentions > 0) score += 15;
  if (credibleMentions > 0) score += 10;

  // Spam / bot penalties
  const spamShare = n > 0 ? dupes / n : 0;
  const botShare = n > 0 ? botLike / n : 0;
  if (spamShare > 0.3) {
    score -= 20;
    reasons.push(`duplicate spam share ${(spamShare * 100).toFixed(0)}%`);
  }
  if (botShare > 0.4) {
    score -= 20;
    reasons.push(`bot-like account share ${(botShare * 100).toFixed(0)}%`);
  }

  // Multiple CAs flagged for the same token = fake-contract risk.
  let signalType: BuzzSignalType = 'EARLY_BUZZ';
  if (input.contractAddress && distinctCAs > 1) {
    score -= 15;
    reasons.push(`multiple distinct CAs in posts (${distinctCAs}) — fake-CA risk`);
    signalType = 'FAKE_CONTRACT_RISK';
  } else if (officialMentions > 0) {
    signalType = 'OFFICIAL_ANNOUNCEMENT';
  } else if (perMin >= 5) {
    signalType = 'VIRAL_ACCELERATION';
  } else if (perMin >= 1 && credibleMentions > 0) {
    signalType = 'NEWS_CATALYST';
  } else if (input.contractAddress && distinctCAs === 1) {
    signalType = 'CONTRACT_ADDRESS_TRENDING';
  }

  // Influencer-pump risk: most posts are from a tiny set of huge accounts.
  if (n >= 20 && uniqueAuthors / n < 0.2 && highFollowerShare > 0.5) {
    score -= 10;
    reasons.push('few big accounts dominating posts — influencer pump risk');
    signalType = 'INFLUENCER_PUMP_RISK';
  }

  // Exhaustion: huge engagement but velocity already declining (caller-supplied window comparison
  // should be done at a higher layer; we use a heuristic here based on engagement-to-recent-post ratio).
  // Left to higher layers — the strategy module decides EXHAUSTION_RISK by comparing windows.

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    signalType,
    breakdown: {
      posts: n,
      uniqueAuthors,
      verifiedShare,
      highFollowerShare,
      spamShare,
      botShare,
      engagement,
      officialMentions,
      credibleMentions,
      distinctCAs,
    },
    reasons,
  };
}
