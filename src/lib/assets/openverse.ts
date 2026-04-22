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

export async function fetchFromOpenverse(scene: ScenePlan): Promise<VisualAsset> {
  const hash = sceneHash(scene);

  // Try each search term, then mood as last-resort
  const queries = [
    ...scene.searchTerms.map(extractKeywords).filter((q) => q.length > 0),
    scene.mood ?? "contemplative",
  ];

  for (const query of queries) {
    try {
      const results = await openverseSearch(query);
      if (results.length === 0) continue;

      const idx = deterministicIndex(hash + query, results.length);
      const img = results[idx];

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
    } catch {
      continue;
    }
  }

  throw new Error("No Openverse results for any query variant");
}
