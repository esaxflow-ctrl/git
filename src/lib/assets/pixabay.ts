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

// Extract concrete visual keywords from a cinematic search term string
function extractPixabayKeywords(term: string): string {
  const skip = new Set([
    "close", "up", "extreme", "wide", "shot", "medium", "overhead", "angle",
    "cinematic", "moody", "dramatic", "editorial", "style", "glow", "warm",
    "cool", "lighting", "composition", "framing", "avoid", "natural", "candid",
  ]);
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !skip.has(w))
    .slice(0, 3)
    .join("+");
}

async function pixabaySearch(
  query: string,
  apiKey: string | undefined
): Promise<{ hits: Array<{ id: number; imageWidth: number; imageHeight: number; largeImageURL: string; webformatURL: string; user: string }> }> {
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
  return res.json() as Promise<{ hits: Array<{ id: number; imageWidth: number; imageHeight: number; largeImageURL: string; webformatURL: string; user: string }> }>;
}

export async function fetchFromPixabay(scene: ScenePlan): Promise<VisualAsset> {
  const apiKey = process.env.PIXABAY_API_KEY;
  const hash = sceneHash(scene);

  // Try each search term in order, with extracted keywords
  const queries = [
    ...scene.searchTerms.map((t) => extractPixabayKeywords(t)),
    scene.mood ?? "contemplative",
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const data = await pixabaySearch(query, apiKey);
      if (!data.hits || data.hits.length === 0) continue;

      const idx = deterministicIndex(hash + query, data.hits.length);
      const photo = data.hits[idx];

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
        },
      };
    } catch {
      continue;
    }
  }

  throw new Error("No Pixabay results for any query variant");
}
