import { ScenePlan, StyleProfile, VisualAsset } from "../validation/schemas";
import { assetCache, assetCacheKey } from "../cache";
import { fetchFromPexels } from "./pexels";
import { fetchFromPixabay } from "./pixabay";
import { fetchFromOpenverse } from "./openverse";
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
  const demo = process.env.DEMO_MODE === "1";

  if (!needsGenerated) {
    // 1. Pexels — paid (free key, but counts as a "paid provider"). Skip in demo.
    if (!demo && process.env.PEXELS_API_KEY) {
      asset = await tryProvider("pexels", () => fetchFromPexels(scene));
    }

    // 2. Pixabay — same treatment as Pexels.
    if (!asset && !needsVideo && !demo && process.env.PIXABAY_API_KEY) {
      asset = await tryProvider("pixabay", () => fetchFromPixabay(scene));
    }

    // 3. Openverse — free, no API key required, CC-licensed images.
    // Allowed in demo mode because it costs nothing. This is what stops
    // demo videos from being a 100% text slideshow.
    if (!asset) {
      asset = await tryProvider("openverse", () => fetchFromOpenverse(scene));
    }
  }

  // 4. Always-available final fallback: generated SVG motion graphic
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
