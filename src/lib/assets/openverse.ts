import { ScenePlan, VisualAsset } from "../validation/schemas";
import crypto from "crypto";

const OPENVERSE_BASE = "https://api.openverse.org/v1";

function deterministicIndex(seed: string, max: number): number {
  const hash = crypto.createHash("md5").update(seed).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % max;
}

function sceneHash(scene: ScenePlan): string {
  return crypto
    .createHash("md5")
    .update(scene.searchTerms.join(",") + scene.visualMode)
    .digest("hex")
    .slice(0, 8);
}

// Strip shot-descriptor words that hurt search precision
function extractKeywords(term: string): string {
  const skip = new Set([
    "close", "up", "extreme", "wide", "shot", "medium", "overhead", "angle",
    "cinematic", "moody", "dramatic", "editorial", "style", "glow", "warm",
    "cool", "lighting", "composition", "framing", "avoid", "natural", "candid",
    "vérité", "verite", "tracking", "follow",
  ]);
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !skip.has(w))
    .slice(0, 4)
    .join(" ");
}

interface OpenverseImage {
  id: string;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  creator: string;
  license: string;
}

async function openverseSearch(query: string): Promise<OpenverseImage[]> {
  const params = new URLSearchParams({
    q: query,
    page_size: "20",
    aspect_ratio: "tall",
    license_type: "all-cc",
    mature: "false",
  });

  const res = await fetch(`${OPENVERSE_BASE}/images/?${params.toString()}`, {
    headers: {
      "User-Agent": "ShortFormVideoSystem/1.0 (local tool)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Openverse returned ${res.status}`);
  }

  const data = (await res.json()) as { results?: OpenverseImage[] };
  return data.results ?? [];
}

// Score an image result for portrait suitability (higher = better for 9:16)
function qualityScore(img: OpenverseImage): number {
  let s = 0;
  const w = img.width || 0;
  const h = img.height || 0;

  // Portrait orientation strongly preferred
  if (h > w) s += 4;
  else if (h === w) s += 1;
  // else landscape: 0

  // Minimum resolution threshold
  const minDim = Math.min(w, h);
  if (minDim >= 800) s += 3;
  else if (minDim >= 400) s += 1;
  else if (minDim === 0) s -= 2; // unknown dimensions, lower confidence

  // Prefer images with known creator attribution
  if (img.creator && img.creator !== "unknown") s += 1;

  return s;
}

export async function fetchFromOpenverse(scene: ScenePlan): Promise<VisualAsset> {
  const hash = sceneHash(scene);

  // Try each search term, then progressively simpler fallbacks
  const queries = [
    ...scene.searchTerms.map(extractKeywords).filter((q) => q.length > 0),
    // Simplified fallback: just the first 2 keywords without shot descriptors
    scene.searchTerms[0]
      ? extractKeywords(scene.searchTerms[0]).split(" ").slice(0, 2).join(" ")
      : "",
    scene.mood ?? "contemplative",
  ].filter((q) => q.length >= 2);

  const candidateQueries: string[] = [];

  for (const query of queries) {
    candidateQueries.push(query);
    try {
      const results = await openverseSearch(query);
      if (results.length === 0) continue;

      // Rank by portrait quality, pick deterministically from top-half
      const scored = results.map((r) => ({ img: r, score: qualityScore(r) }));
      scored.sort((a, b) => b.score - a.score);
      const topScore = scored[0]?.score ?? 0;
      const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
      const idx = deterministicIndex(hash + query, topHalf.length);
      const img = topHalf[idx].img;

      return {
        type: "stockImage",
        provider: "openverse",
        url: img.url,
        svgData: null,
        thumbnailUrl: img.thumbnail,
        metadata: {
          width: img.width || 1080,
          height: img.height || 1920,
          durationSeconds: null,
          attribution: `Photo by ${img.creator} via Openverse (${img.license})`,
          sceneHash: hash,
          debug: {
            candidateQueries,
            candidateCount: results.length,
            topScore,
            rankingReason: `portrait ${img.height > img.width ? "✓" : "✗"} minDim=${Math.min(img.width || 0, img.height || 0)}`,
          },
        },
      };
    } catch {
      continue;
    }
  }

  throw new Error("No Openverse results for any query variant");
}
