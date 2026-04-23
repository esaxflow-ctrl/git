import { Router } from "express";
import { z } from "zod";
import { ScenePlanSchema, VisualAssetSchema, AudioResultSchema } from "../../lib/validation/schemas";
import { analyzeQuality } from "../../lib/qualityGate";

export const analyzeRouter = Router();

const AnalyzeRequestSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  resolvedAssets: z.array(VisualAssetSchema).optional(),
  audioResults: z.array(AudioResultSchema.partial()).optional(),
});

analyzeRouter.post("/analyze", async (req, res) => {
  const parse = AnalyzeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { scenes, resolvedAssets, audioResults } = parse.data;

  const report = analyzeQuality(
    scenes,
    resolvedAssets ?? null,
    audioResults
      ? audioResults.map((a) => ({
          path: "",
          durationMs: a.durationMs ?? 0,
          provider: a.provider ?? "silent",
          wordTimings: a.wordTimings ?? null,
        }))
      : null
  );

  res.json(report);
});
