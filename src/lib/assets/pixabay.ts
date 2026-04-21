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

export async function fetchFromPixabay(scene: ScenePlan): Promise<VisualAsset> {
  const apiKey = process.env.PIXABAY_API_KEY;
  const query = scene.searchTerms.join("+");
  const hash = sceneHash(scene);

  const params = new URLSearchParams({
    q: query,
    image_type: "photo",
    orientation: "vertical",
    per_page: "15",
    safesearch: "true",
  });

  if (apiKey) {
    params.set("key", apiKey);
  }

  const url = `${PIXABAY_BASE}/?${params.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    throw new Error(`Pixabay returned ${res.status}`);
  }

  const data = (await res.json()) as {
    hits: Array<{
      id: number;
      imageWidth: number;
      imageHeight: number;
      largeImageURL: string;
      webformatURL: string;
      user: string;
    }>;
  };

  if (!data.hits || data.hits.length === 0) {
    throw new Error("No Pixabay results");
  }

  const idx = deterministicIndex(hash, data.hits.length);
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
}
