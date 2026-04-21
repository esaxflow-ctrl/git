import { Router } from "express";
import { SynthesizeRequestSchema } from "../../lib/validation/schemas";
import { synthesizeScenes } from "../../lib/tts";

export const ttsRouter = Router();

ttsRouter.post("/synthesize", async (req, res) => {
  const parse = SynthesizeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { scenes, voiceId, speed } = parse.data;

  try {
    const { audioResults, provider } = await synthesizeScenes(scenes, {
      voiceId: voiceId ?? "af_sky",
      speed: speed ?? 1.0,
    });

    const totalDurationMs = audioResults.reduce((sum, a) => sum + a.durationMs, 0);

    // Strip server-side paths before sending to client
    const clientSafeResults = audioResults.map(({ path: _path, ...rest }) => rest);

    res.json({ audioResults: clientSafeResults, provider, totalDurationMs });
  } catch (err) {
    console.error("[tts] error:", err);
    res.status(500).json({ error: "tts_failed", message: String(err) });
  }
});
