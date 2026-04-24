import { Router } from "express";
import { z } from "zod";
import { ResolveVisualsRequestSchema, ScenePlanSchema } from "../../lib/validation/schemas";
import { resolveAllVisuals, resolveVisual } from "../../lib/assets";
import { getStyleProfile } from "../../lib/styleProfiles";

export const assetsRouter = Router();

assetsRouter.post("/resolve-visuals", async (req, res) => {
  const parse = ResolveVisualsRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { scenes, styleId } = parse.data;

  let style;
  try {
    style = getStyleProfile(styleId);
  } catch (err) {
    res.status(400).json({ error: "unknown_style", message: String(err) });
    return;
  }

  try {
    const assets = await resolveAllVisuals(scenes, style);
    const providers = [...new Set(assets.map((a) => a.provider))];
    res.json({ assets, providers });
  } catch (err) {
    console.error("[assets] error:", err);
    res.status(500).json({ error: "asset_resolution_failed", message: String(err) });
  }
});

// Resolve a single scene's visual — used by the storyboard swap UI
const ResolveOneSchema = z.object({
  scene: ScenePlanSchema,
  styleId: z.string(),
});

assetsRouter.post("/resolve-visual", async (req, res) => {
  const parse = ResolveOneSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { scene, styleId } = parse.data;

  let style;
  try {
    style = getStyleProfile(styleId);
  } catch (err) {
    res.status(400).json({ error: "unknown_style", message: String(err) });
    return;
  }

  try {
    const asset = await resolveVisual(scene, style);
    res.json({ asset, provider: asset.provider });
  } catch (err) {
    console.error("[assets:one] error:", err);
    res.status(500).json({ error: "asset_resolution_failed", message: String(err) });
  }
});
