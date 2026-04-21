import { ScenePlan, VisualAsset } from "../validation/schemas";
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

export async function fetchFromPexels(scene: ScenePlan): Promise<VisualAsset> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY not set");

  const query = scene.searchTerms.join(" ");
  const isVideo = scene.visualMode === "stockVideo";
  const hash = sceneHash(scene);

  const url = isVideo
    ? `${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait`
    : `${PEXELS_BASE}/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait`;

  const res = await fetch(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Pexels returned ${res.status}`);
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

    if (!data.videos || data.videos.length === 0) {
      throw new Error("No Pexels video results");
    }

    const idx = deterministicIndex(hash, data.videos.length);
    const video = data.videos[idx];

    // Prefer HD or Full HD file
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

    if (!data.photos || data.photos.length === 0) {
      throw new Error("No Pexels photo results");
    }

    const idx = deterministicIndex(hash, data.photos.length);
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
