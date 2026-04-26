import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { RenderRequestSchema, RenderJob, AudioResult } from "../../lib/validation/schemas";
import { getStyleProfile } from "../../lib/styleProfiles";
import { renderVideo, buildInputProps } from "../render/remotionRender";
import { synthesizeScenes } from "../../lib/tts";
import { exportSRT } from "../../lib/captions/srt";
import { buildCaptionEntries } from "../../lib/captions";
import { resolveBackgroundMusic } from "../../lib/music";
import { validateExport, ExportValidation } from "../render/exportValidator";
import { buildDebugReport, writeDebugReport, DebugReport } from "../render/debugReport";

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp/sfv-output";

// In-memory job store (sufficient for single-user local tool)
export const jobs = new Map<string, RenderJob>();

// Per-job validation + debug report, keyed alongside `jobs`.
export const jobReports = new Map<
  string,
  { validation: ExportValidation | null; report: DebugReport | null }
>();

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
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(srtPath, srtContent);

  const reportPath = path.join(OUTPUT_DIR, `${jobId}.report.json`);

  // Start render async
  setImmediate(async () => {
    job.status = "bundling";
    job.progressPercent = 0;

    let renderErr: unknown = null;
    try {
      await renderVideo(job, (pct) => {
        job.status = "rendering";
        job.progressPercent = pct;
      });
    } catch (err) {
      renderErr = err;
      job.status = "error";
      job.errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[render:${jobId}] failed:`, err);
    }

    // Validate and write a debug report regardless of success/failure.
    let validation: ExportValidation | null = null;
    try {
      const expected = job.audioResults.reduce((sum, a) => sum + (a.durationMs ?? 0), 0) / 1000;
      validation = await validateExport(job.outputPath, expected || 60, job.audioEnabled);
      if (!validation.pass) {
        console.warn(
          `[render:${jobId}] export validation failed: ${validation.failures.join("; ")}`
        );
      } else {
        console.info(
          `[render:${jobId}] export validated: ${validation.durationSeconds?.toFixed(2)}s, ${validation.width}x${validation.height}, audio=${validation.hasAudio}, ${validation.fileSizeBytes} bytes`
        );
      }
    } catch (err) {
      console.warn(`[render:${jobId}] validation error: ${err}`);
    }

    if (!renderErr && validation && !validation.pass) {
      job.status = "error";
      job.errorMessage = `Export validation failed: ${validation.failures.join("; ")}`;
    } else if (!renderErr) {
      job.status = "done";
      job.progressPercent = 100;
    }

    const report = buildDebugReport(job, captionEntries.length, validation);
    writeDebugReport(reportPath, report);
    jobReports.set(jobId, { validation, report });
  });

  res.json({ jobId });
});

renderRouter.get("/:jobId/report", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  const reportPath = path.join(OUTPUT_DIR, `${req.params.jobId}.report.json`);
  if (!fs.existsSync(reportPath)) {
    const cached = jobReports.get(req.params.jobId);
    if (cached?.report) {
      res.json(cached.report);
      return;
    }
    res.status(404).json({ error: "report_not_ready", status: job.status });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  fs.createReadStream(reportPath).pipe(res);
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
