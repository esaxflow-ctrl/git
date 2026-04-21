import { ScenePlan, StyleProfile, VisualAsset } from "../validation/schemas";
import { assetCache, assetCacheKey } from "../cache";
import { fetchFromPexels } from "./pexels";
import { fetchFromPixabay } from "./pixabay";
import { generateMotionGraphic } from "./motionGraphics";

async function tryProvider(
  name: string,
  fn: () => Promise<VisualAsset>
): Promise<VisualAsset | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[assets:${name}] failed: ${err}`);
    return null;
  }
}

export async function resolveVisual(
  scene: ScenePlan,
  style: StyleProfile
): Promise<VisualAsset> {
  const cacheKey = assetCacheKey(scene.searchTerms, scene.visualMode);
  const cached = await assetCache.get(cacheKey);
  if (cached) return cached as VisualAsset;

  const needsVideo = scene.visualMode === "stockVideo";
  const needsPhoto = scene.visualMode === "stockImage";
  const needsGenerated = !needsVideo && !needsPhoto;

  let asset: VisualAsset | null = null;

  if (!needsGenerated) {
    // Try Pexels (handles both video and image)
    if (process.env.PEXELS_API_KEY) {
      asset = await tryProvider("pexels", () => fetchFromPexels(scene));
    }

    // Try Pixabay (images only)
    if (!asset && !needsVideo) {
      asset = await tryProvider("pixabay", () => fetchFromPixabay(scene));
    }
  }

  // Always-available fallback: generated SVG
  if (!asset) {
    asset = generateMotionGraphic(scene, style);
  }

  await assetCache.set(cacheKey, asset);
  return asset;
}

export async function resolveAllVisuals(
  scenes: ScenePlan[],
  style: StyleProfile
): Promise<VisualAsset[]> {
  return Promise.all(scenes.map((scene) => resolveVisual(scene, style)));
}
