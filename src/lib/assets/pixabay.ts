import { ScenePlan, VisualAsset } from "../validation/schemas";
import crypto from "crypto";

const PIXABAY_BASE = "https://pixabay.com/api";

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

const SKIP_WORDS = new Set([
  "close", "up", "extreme", "wide", "shot", "medium", "overhead", "angle",
  "cinematic", "moody", "dramatic", "editorial", "style", "glow", "warm",
  "cool", "lighting", "composition", "framing", "avoid", "natural", "candid",
]);

function extractPixabayKeywords(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SKIP_WORDS.has(w))
    .slice(0, 3)
    .join("+");
}

interface PixabayHit {
  id: number;
  imageWidth: number;
  imageHeight: number;
  largeImageURL: string;
  webformatURL: string;
  user: string;
}

// Portrait quality scoring — same rubric as pexels/openverse
function scorePixabayPhoto(w: number, h: number): number {
  let s = 0;
  if (h > w) s += 4;
  else if (h === w) s += 1;
  const minDim = Math.min(w, h);
  if (minDim >= 1080) s += 3;
  else if (minDim >= 700) s += 1;
  return s;
}

async function pixabaySearch(
  query: string,
  apiKey: string | undefined
): Promise<{ hits: PixabayHit[] }> {
  const params = new URLSearchParams({
    q: query,
    image_type: "photo",
    orientation: "vertical",
    per_page: "20",
    safesearch: "true",
  });
  if (apiKey) params.set("key", apiKey);

  const res = await fetch(`${PIXABAY_BASE}/?${params.toString()}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Pixabay returned ${res.status}`);
  return res.json() as Promise<{ hits: PixabayHit[] }>;
}

export async function fetchFromPixabay(scene: ScenePlan): Promise<VisualAsset> {
  const apiKey = process.env.PIXABAY_API_KEY;
  const hash = sceneHash(scene);

  const termQueries = scene.searchTerms.map(extractPixabayKeywords).filter(Boolean);
  const expandedQuery = termQueries[0]
    ? termQueries[0].split("+").slice(0, 2).join("+")
    : "";
  const queries = [
    ...termQueries,
    ...(expandedQuery && !termQueries.includes(expandedQuery) ? [expandedQuery] : []),
    scene.mood ?? "contemplative",
  ].filter(Boolean);

  const candidateQueries: string[] = [];

  for (const query of queries) {
    candidateQueries.push(query);
    try {
      const data = await pixabaySearch(query, apiKey);
      if (!data.hits || data.hits.length === 0) continue;

      const scored = data.hits.map((h) => ({
        hit: h,
        score: scorePixabayPhoto(h.imageWidth, h.imageHeight),
      }));
      scored.sort((a, b) => b.score - a.score);

      const topScore = scored[0]?.score ?? 0;

      // Try next query if best is very weak portrait candidate
      if (topScore < 4 && query !== queries[queries.length - 1]) continue;

      const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
      const idx = deterministicIndex(hash + query, topHalf.length);
      const photo = topHalf[idx].hit;

      return {
        type: "stockImage",
        provider: "pixabay",
        url: photo.largeImageURL,
        svgData: null,
        thumbnailUrl: photo.webformatURL,
        metadata: {
          width: photo.imageWidth,
          height: photo.imageHeight,
          durationSeconds: null,
          attribution: `Photo by ${photo.user} on Pixabay (ID: ${photo.id})`,
          sceneHash: hash,
          debug: {
            candidateQueries,
            candidateCount: data.hits.length,
            topScore,
            rankingReason: `portrait ${photo.imageHeight > photo.imageWidth ? "✓" : "✗"} minDim=${Math.min(photo.imageWidth, photo.imageHeight)}`,
          },
        },
      };
    } catch {
      continue;
    }
  }

  throw new Error("No Pixabay results for any query variant");
}
