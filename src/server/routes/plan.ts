import { Router } from "express";
import { PlanRequestSchema } from "../../lib/validation/schemas";
import { generateScenes } from "../../lib/planner";
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

  const { script, styleId, options } = parse.data;

  let style;
  try {
    style = getStyleProfile(styleId);
  } catch (err) {
    res.status(400).json({ error: "unknown_style", message: String(err) });
    return;
  }

  const cacheKey = planCacheKey(script, styleId);
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
      targetDurationSeconds: options?.targetDurationSeconds ?? 67,
      minScenes: options?.minScenes ?? 4,
      maxScenes: options?.maxScenes ?? 8,
    };

    const { scenes, provider } = await generateScenes(script, planOptions);

    const validation = validateScenePlan(scenes);
    const warnings = [
      ...(validation.warnings ?? []),
      ...detectVisualRepetition(scenes),
      ...pacingVarianceCheck(scenes),
    ];

    await planCache.set(cacheKey, scenes);

    res.json({ scenes, warnings, provider, cached: false });
  } catch (err) {
    console.error("[plan] error:", err);
    res.status(500).json({ error: "planning_failed", message: String(err) });
  }
});
