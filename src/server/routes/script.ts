import { Router } from "express";
import { z } from "zod";
import { generateScript } from "../../lib/script/generator";
import { validateScript } from "../../lib/script/validate";

export const scriptRouter = Router();

const GenerateRequestSchema = z.object({
  topic: z.string().min(3).max(500),
  niche: z.string().max(80).optional(),
  tone: z.string().max(120).optional(),
  targetViewer: z.string().max(160).optional(),
  visualStyle: z.string().max(160).optional(),
  voiceStyle: z.string().max(120).optional(),
  ctaStyle: z.string().max(60).optional(),
  platform: z.string().max(60).optional(),
  referenceStyle: z.string().max(160).optional(),
  bannedPhrases: z.array(z.string().max(60)).max(20).optional(),
});

scriptRouter.post("/generate", async (req, res) => {
  const parse = GenerateRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  try {
    const result = await generateScript(parse.data);
    res.json(result);
  } catch (err) {
    console.error("[script] generation failed:", err);
    res.status(500).json({ error: "script_generation_failed", message: String(err) });
  }
});

const ValidateRequestSchema = z.object({
  script: z.string().min(1).max(5000),
});

scriptRouter.post("/validate", (req, res) => {
  const parse = ValidateRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }
  res.json(validateScript(parse.data.script));
});
