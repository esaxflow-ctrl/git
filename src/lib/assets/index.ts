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

// Append style-specific search modifiers to a scene's search terms.
// Returns a shallow clone of the scene with augmented terms so the original
// plan is not mutated.
function applyStyleModifiers(scene: ScenePlan, style: StyleProfile): ScenePlan {
  const modifiers = style.searchModifiers?.trim();
  if (!modifiers) return scene;
  return {
    ...scene,
    searchTerms: scene.searchTerms.map((t) => `${t} ${modifiers}`),
  };
}

export async function resolveVisual(
  scene: ScenePlan,
  style: StyleProfile
): Promise<VisualAsset> {
  const cacheKey = assetCacheKey(scene.searchTerms, scene.visualMode);
  const cached = await assetCache.get(cacheKey);
  if (cached) return cached as VisualAsset;

  const augmented = applyStyleModifiers(scene, style);

  const needsVideo = scene.visualMode === "stockVideo";
  const needsPhoto = scene.visualMode === "stockImage";
  const needsGenerated = !needsVideo && !needsPhoto;

  let asset: VisualAsset | null = null;

  if (!needsGenerated) {
    // 1. Pexels — video OR image, requires API key
    if (process.env.PEXELS_API_KEY) {
      asset = await tryProvider("pexels", () => fetchFromPexels(augmented));
    }

    // 2. Pixabay — images only, requires API key (key is optional but usually needed)
    if (!asset && !needsVideo && process.env.PIXABAY_API_KEY) {
      asset = await tryProvider("pixabay", () => fetchFromPixabay(augmented));
    }

    // 3. Openverse — free, no API key required, CC-licensed images
    if (!asset) {
      asset = await tryProvider("openverse", () => fetchFromOpenverse(augmented));
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
