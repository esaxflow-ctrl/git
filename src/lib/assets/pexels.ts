import { ScenePlan, VisualAsset, VisualPurpose } from "../validation/schemas";
import crypto from "crypto";

const PEXELS_BASE = "https://api.pexels.com";

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

// Build a cinematic query from the scene's specific search terms and purpose.
// Pexels works best with 2-4 concrete keywords, so we extract the most
// visual/concrete words from the cinematic search terms.
function buildPexelsQuery(scene: ScenePlan, termIndex = 0): string {
  const term = scene.searchTerms[termIndex];
  if (!term) return scene.searchTerms[0] ?? scene.mood ?? "contemplative";

  // Strip overly descriptive words that confuse stock search engines;
  // keep nouns, actions, and setting words.
  const skipWords = new Set([
    "close", "up", "extreme", "wide", "shot", "angle", "medium", "overhead",
    "tracking", "style", "cinematic", "moody", "dramatic", "realistic",
    "light", "lighting", "color", "palette", "tone", "avoid", "framing",
    "editorial", "composition", "glow", "warm", "cool", "soft", "harsh",
    "visible", "implied", "natural", "candid", "vérité",
  ]);

  const words = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !skipWords.has(w));

  // Keep 3-4 most meaningful words
  return words.slice(0, 4).join(" ") || scene.mood || "contemplative";
}

// Fallback query: use different search term or mood-based imagery
function buildFallbackQuery(scene: ScenePlan, termIndex = 0): string {
  // Try next search term first
  const nextTerm = scene.searchTerms[termIndex + 1];
  if (nextTerm) return buildPexelsQuery(scene, termIndex + 1);

  // Purpose-based fallback vocabulary
  const purposeFallbacks: Record<VisualPurpose, string> = {
    show_behavior: "person daily routine close up",
    show_emotion: "human emotion close up portrait",
    show_consequence: "quiet room aftermath stillness",
    show_reframe: "perspective wide view contemplative",
    show_action: "hands working focused task",
  };

  return scene.visualPurpose
    ? purposeFallbacks[scene.visualPurpose]
    : `${scene.mood} atmosphere close up`;
}

async function pexelsSearch(
  query: string,
  isVideo: boolean,
  apiKey: string
): Promise<Response> {
  const url = isVideo
    ? `${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&per_page=20&orientation=portrait`
    : `${PEXELS_BASE}/v1/search?query=${encodeURIComponent(query)}&per_page=20&orientation=portrait`;

  return fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10000),
  });
}

export async function fetchFromPexels(scene: ScenePlan): Promise<VisualAsset> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY not set");

  const isVideo = scene.visualMode === "stockVideo";
  const hash = sceneHash(scene);

  // Try primary query first, then fall back to alternate queries
  const queries = [
    buildPexelsQuery(scene, 0),
    buildPexelsQuery(scene, 1),
    buildFallbackQuery(scene, 0),
  ];

  for (const query of queries) {
    const res = await pexelsSearch(query, isVideo, apiKey);

    if (!res.ok) {
      if (res.status === 429) throw new Error("Pexels rate limit hit");
      continue;
    }

    if (isVideo) {
      const data = (await res.json()) as {
        videos: Array<{
          id: number;
          width: number;
          height: number;
          duration: number;
          video_files: Array<{ link: string; width: number; height: number; quality: string }>;
        }>;
      };

      if (!data.videos || data.videos.length === 0) continue;

      const idx = deterministicIndex(hash + query, data.videos.length);
      const video = data.videos[idx];

      const file =
        video.video_files.find((f) => f.quality === "hd" && f.height >= 1080) ??
        video.video_files.find((f) => f.quality === "hd") ??
        video.video_files[0];

      return {
        type: "stockVideo",
        provider: "pexels",
        url: file.link,
        svgData: null,
        thumbnailUrl: null,
        metadata: {
          width: file.width,
          height: file.height,
          durationSeconds: video.duration,
          attribution: `Video by Pexels (ID: ${video.id})`,
          sceneHash: hash,
        },
      };
    } else {
      const data = (await res.json()) as {
        photos: Array<{
          id: number;
          width: number;
          height: number;
          src: { large2x: string; large: string; original: string };
        }>;
      };

      if (!data.photos || data.photos.length === 0) continue;

      const idx = deterministicIndex(hash + query, data.photos.length);
      const photo = data.photos[idx];

      return {
        type: "stockImage",
        provider: "pexels",
        url: photo.src.large2x ?? photo.src.large,
        svgData: null,
        thumbnailUrl: photo.src.large,
        metadata: {
          width: photo.width,
          height: photo.height,
          durationSeconds: null,
          attribution: `Photo by Pexels (ID: ${photo.id})`,
          sceneHash: hash,
        },
      };
    }
  }

  throw new Error("No Pexels results for any query variant");
}
