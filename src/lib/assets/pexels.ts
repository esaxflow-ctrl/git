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

const SKIP_WORDS = new Set([
  "close", "up", "extreme", "wide", "shot", "angle", "medium", "overhead",
  "tracking", "style", "cinematic", "moody", "dramatic", "realistic",
  "light", "lighting", "color", "palette", "tone", "avoid", "framing",
  "editorial", "composition", "glow", "warm", "cool", "soft", "harsh",
  "visible", "implied", "natural", "candid", "vérité",
]);

function buildPexelsQuery(term: string): string {
  const words = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SKIP_WORDS.has(w));
  return words.slice(0, 4).join(" ");
}

function buildFallbackQuery(scene: ScenePlan): string {
  const purposeFallbacks: Record<VisualPurpose, string> = {
    show_behavior: "person daily routine detail",
    show_emotion: "human emotion portrait close up",
    show_consequence: "quiet room aftermath stillness",
    show_reframe: "perspective wide view contemplative",
    show_action: "hands working focused task",
  };
  return scene.visualPurpose
    ? purposeFallbacks[scene.visualPurpose]
    : `${scene.mood} atmosphere`;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  src: { large2x: string; large: string; original: string };
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: Array<{ link: string; width: number; height: number; quality: string }>;
}

// Portrait quality scoring — mirrors openverse.qualityScore()
function scorePhoto(w: number, h: number, hasLarge2x: boolean): number {
  let s = 0;
  if (h > w) s += 4;
  else if (h === w) s += 1;
  const minDim = Math.min(w, h);
  if (minDim >= 1080) s += 3;
  else if (minDim >= 700) s += 1;
  if (hasLarge2x) s += 1;
  return s;
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

  // Build query sequence: primary terms → 2-word expansion → purpose fallback
  const termQueries = scene.searchTerms
    .map(buildPexelsQuery)
    .filter((q) => q.length >= 3);
  const expandedQuery = termQueries[0]
    ? termQueries[0].split(" ").slice(0, 2).join(" ")
    : "";
  const queries = [
    ...termQueries,
    ...(expandedQuery && !termQueries.includes(expandedQuery) ? [expandedQuery] : []),
    buildFallbackQuery(scene),
  ].filter(Boolean);

  const candidateQueries: string[] = [];

  for (const query of queries) {
    candidateQueries.push(query);
    const res = await pexelsSearch(query, isVideo, apiKey);

    if (!res.ok) {
      if (res.status === 429) throw new Error("Pexels rate limit hit");
      continue;
    }

    if (isVideo) {
      const data = (await res.json()) as { videos: PexelsVideo[] };
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
          debug: {
            candidateQueries,
            candidateCount: data.videos.length,
            topScore: 0,
            rankingReason: "video hd portrait preferred",
          },
        },
      };
    }

    // Photo path — rank by portrait quality, pick from top half
    const data = (await res.json()) as { photos: PexelsPhoto[] };
    if (!data.photos || data.photos.length === 0) continue;

    const scored = data.photos.map((p) => ({
      photo: p,
      score: scorePhoto(p.width, p.height, Boolean(p.src.large2x)),
    }));
    scored.sort((a, b) => b.score - a.score);

    const topScore = scored[0]?.score ?? 0;

    // If best candidate is very weak (score < 4), try the next query for better results
    if (topScore < 4 && query !== queries[queries.length - 1]) continue;

    const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
    const idx = deterministicIndex(hash + query, topHalf.length);
    const photo = topHalf[idx].photo;

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
        debug: {
          candidateQueries,
          candidateCount: data.photos.length,
          topScore,
          rankingReason: `portrait ${photo.height > photo.width ? "✓" : "✗"} minDim=${Math.min(photo.width, photo.height)}`,
        },
      },
    };
  }

  throw new Error("No Pexels results for any query variant");
}
