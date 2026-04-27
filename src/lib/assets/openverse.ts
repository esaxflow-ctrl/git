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

// Broad-but-evocative fallback queries by mood. Used only after specific
// queries return nothing, so we still get *some* photo instead of a black
// gradient. Each is 1–2 words that Openverse reliably returns results for.
const MOOD_FALLBACK_QUERIES: Record<string, string[]> = {
  hollow: ["empty room", "dim window"],
  dread: ["dark hallway", "rain window"],
  restless: ["late night", "city window"],
  relief: ["morning light", "open window"],
  triumphant: ["sunrise", "open road"],
  mysterious: ["fog forest", "alley night"],
  analytical: ["desk light", "open book"],
  historical: ["old photo", "vintage room"],
  defiant: ["mirror morning", "city walk"],
  neutral: ["quiet room", "morning light"],
};

const UNIVERSAL_FALLBACK_QUERIES = ["window light", "quiet room", "morning", "city street", "hands desk"];

function buildOpenverseQueries(scene: ScenePlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (t.length >= 2 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  // 1. Original search terms with shot descriptors stripped.
  for (const term of scene.searchTerms) {
    add(extractKeywords(term));
  }
  // 2. First 2 content words from each term (more likely to match).
  for (const term of scene.searchTerms) {
    const words = extractKeywords(term).split(" ").filter(Boolean);
    if (words.length >= 2) add(words.slice(0, 2).join(" "));
    if (words.length >= 1) add(words[0]);
  }
  // 3. Mood-driven fallback (broad but evocative).
  const moodQueries = MOOD_FALLBACK_QUERIES[scene.mood ?? "neutral"] ?? MOOD_FALLBACK_QUERIES.neutral;
  for (const q of moodQueries) add(q);
  // 4. Universal last-resort. Always returns something on Openverse.
  for (const q of UNIVERSAL_FALLBACK_QUERIES) add(q);

  return out;
}

export async function fetchFromOpenverse(scene: ScenePlan): Promise<VisualAsset> {
  const hash = sceneHash(scene);
  const queries = buildOpenverseQueries(scene);

  const errors: string[] = [];
  for (const query of queries) {
    try {
      const results = await openverseSearch(query);
      if (results.length === 0) {
        errors.push(`"${query}" → 0 results`);
        continue;
      }

      // Rank by portrait quality, pick deterministically from top-half
      const ranked = [...results].sort((a, b) => qualityScore(b) - qualityScore(a));
      const topHalf = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
      const idx = deterministicIndex(hash + query, topHalf.length);
      const img = topHalf[idx];

      console.info(`[assets:openverse] "${query}" → ${results.length} results, picked ${img.url.slice(0, 80)}`);

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
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`"${query}" → ${msg.slice(0, 100)}`);
      continue;
    }
  }

  throw new Error(
    `No Openverse results across ${queries.length} queries. Last few: ${errors.slice(-3).join(" | ")}`
  );
}
