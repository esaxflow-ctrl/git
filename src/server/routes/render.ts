import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { RenderRequestSchema, RenderJob, AudioResult } from "../../lib/validation/schemas";
import { getStyleProfile } from "../../lib/styleProfiles";
import { renderVideo, buildInputProps } from "../render/remotionRender";
import { synthesizeScenes } from "../../lib/tts";
import { exportSRT } from "../../lib/captions/srt";
import { buildCaptionEntries } from "../../lib/captions";
import { resolveBackgroundMusic } from "../../lib/music";

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp/sfv-output";

// In-memory job store (sufficient for single-user local tool)
export const jobs = new Map<string, RenderJob>();

function sendSSE(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const renderRouter = Router();

renderRouter.post("/", async (req, res) => {
  const parse = RenderRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "validation", issues: parse.error.issues });
    return;
  }

  const { scenes, resolvedAssets, audioResults: clientAudioResults, styleId, audioEnabled, musicUrl: clientMusicUrl } = parse.data;

  let styleProfile;
  try {
    styleProfile = getStyleProfile(styleId);
  } catch (err) {
    res.status(400).json({ error: "unknown_style", message: String(err) });
    return;
  }

  const jobId = uuidv4();
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  const srtPath = path.join(OUTPUT_DIR, `${jobId}.srt`);

  // Re-synthesize audio server-side if enabled (client only has metadata, not paths)
  let audioResults: AudioResult[];
  if (audioEnabled) {
    try {
      const { audioResults: synced } = await synthesizeScenes(scenes, { voiceId: "af_sky", speed: 1.0 });
      audioResults = synced;
    } catch {
      // Fall back to silent using client-provided durations
      audioResults = clientAudioResults.map((a) => ({
        ...a,
        path: "",
        provider: "silent" as const,
        wordTimings: a.wordTimings ?? null,
      }));
    }
  } else {
    audioResults = clientAudioResults.map((a) => ({
      ...a,
      path: "",
      provider: "silent" as const,
      wordTimings: a.wordTimings ?? null,
    }));
  }

  // Resolve background music (non-blocking, optional)
  const primaryMood = scenes[0]?.mood ?? "cinematic";
  const musicUrl = clientMusicUrl ?? await resolveBackgroundMusic(primaryMood).catch(() => null);

  const job: RenderJob = {
    jobId,
    scenes,
    resolvedAssets,
    audioResults,
    styleProfile,
    audioEnabled,
    musicUrl: musicUrl ?? null,
    outputPath,
    srtPath,
    status: "pending",
    progressPercent: 0,
    errorMessage: null,
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);

  // Generate SRT immediately
  const captionEntries = buildCaptionEntries(
    scenes,
    audioResults,
    styleProfile.captionStyle.maxWordsPerGroup
  );
  const srtContent = exportSRT(captionEntries);
  const fs = await import("fs");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(srtPath, srtContent);

  // Start render async
  setImmediate(async () => {
    job.status = "bundling";
    job.progressPercent = 0;

    try {
      await renderVideo(job, (pct) => {
        job.status = "rendering";
        job.progressPercent = pct;
      });
      job.status = "done";
      job.progressPercent = 100;
    } catch (err) {
      job.status = "error";
      job.errorMessage = String(err);
      console.error(`[render:${jobId}] failed:`, err);
    }
  });

  res.json({ jobId });
});

renderRouter.get("/:jobId/status", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sendSSE(res, {
    status: job.status,
    progressPercent: job.progressPercent,
    errorMessage: job.errorMessage,
  });

  const interval = setInterval(() => {
    if (!res.writableEnded) {
      sendSSE(res, {
        status: job.status,
        progressPercent: job.progressPercent,
        errorMessage: job.errorMessage,
      });
    }

    if (job.status === "done" || job.status === "error") {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => clearInterval(interval));
});
