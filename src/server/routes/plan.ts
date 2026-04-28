import { Router } from "express";
import { PlanRequestSchema } from "../../lib/validation/schemas";
import { generateScenes, buildScenesFromPrebuilt } from "../../lib/planner";
import { getStyleProfile } from "../../lib/styleProfiles";
import { validateScenePlan, detectVisualRepetition, pacingVarianceCheck } from "../../lib/validation/antiGeneric";
import { planCache, planCacheKey } from "../../lib/cache";

export const planRouter = Router();

planRouter.post("/", async (req, res) => {
  const parse = PlanRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { script, styleId, options, prebuiltScenes } = parse.data;

  let style;
  try {
    style = getStyleProfile(styleId);
  } catch (err) {
    res.status(400).json({ error: "unknown_style", message: String(err) });
    return;
  }

  // Cache key includes prebuiltScenes signal so a re-run with the same
  // script but no prebuilt hints doesn't return the prebuilt-derived
  // result.
  const cacheKey = planCacheKey(
    script + (prebuiltScenes ? "::prebuilt" : ""),
    styleId
  );
  const cached = await planCache.get(cacheKey);
  if (cached) {
    const scenes = cached as ReturnType<typeof Array.prototype.map>;
    const warnings = [
      ...detectVisualRepetition(scenes as never),
      ...pacingVarianceCheck(scenes as never),
    ];
    res.json({ scenes, warnings, provider: "cached", cached: true });
    return;
  }

  try {
    const planOptions = {
      style,
      targetDurationSeconds: options?.targetDurationSeconds ?? 60,
      minScenes: options?.minScenes ?? 8,
      maxScenes: options?.maxScenes ?? 14,
    };

    let scenes: unknown[];
    let provider: string;

    if (prebuiltScenes && prebuiltScenes.length > 0) {
      // Template-emitted hints. Skip text re-derivation entirely.
      console.info(
        `[plan] Using ${prebuiltScenes.length} prebuilt scene hints from template`
      );
      scenes = buildScenesFromPrebuilt(prebuiltScenes, planOptions, script);
      provider = "deterministic";
    } else {
      const result = await generateScenes(script, planOptions);
      scenes = result.scenes;
      provider = result.provider;
    }

    const validation = validateScenePlan(scenes as never);
    const warnings = [
      ...(validation.warnings ?? []),
      ...detectVisualRepetition(scenes as never),
      ...pacingVarianceCheck(scenes as never),
    ];

    await planCache.set(cacheKey, scenes);

    res.json({ scenes, warnings, provider, cached: false });
  } catch (err) {
    console.error("[plan] error:", err);
    res.status(500).json({ error: "planning_failed", message: String(err) });
  }
});
