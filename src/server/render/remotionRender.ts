import path from "path";
import fs from "fs";
import {
  RenderJob,
  ShortFormVideoProps,
  SceneWithTiming,
} from "../../lib/validation/schemas";
import { buildCaptionEntries } from "../../lib/captions";

let cachedBundlePath: string | null = null;

// Target output duration band (60s ±2s).
const TARGET_DURATION_MS = 60_000;
const MIN_DURATION_MS = 58_000;
const MAX_DURATION_MS = 62_000;

/**
 * Per-scene durations.
 *
 * When audio is real (not silent), the audio duration plus a small padding
 * is authoritative — we never clamp it down to `pacingRules.maxSceneDurationMs`
 * because that silently truncates voiceover. Pacing caps are only applied
 * for silent / estimated scenes.
 *
 * After per-scene durations are computed, `enforceTotalDuration` adjusts the
 * timeline so the final video lands inside [MIN_DURATION_MS, MAX_DURATION_MS].
 */
// Pacing-aware floor. Style presets set a global minSceneDurationMs (4–5s)
// which is fine for the body of the video, but a "fast"-pacing hook scene
// needs to be ~1.5s for retention — clamping it to 4s kills the cut. Each
// scene's pacing now sets its own floor.
const PACING_MIN_MS: Record<string, number> = {
  fast: 1500,
  medium: 3000,
  slow: 4500,
  dramatic_pause: 5500,
};

function computeSceneDurations(job: RenderJob): number[] {
  const { scenes, audioResults, styleProfile, audioEnabled } = job;
  const { pacingRules } = styleProfile;

  const raw = scenes.map((scene, i) => {
    const audio = audioResults[i];
    const hasRealAudio =
      audioEnabled && audio && audio.provider !== "silent" && audio.durationMs > 0;

    if (hasRealAudio) {
      // Audio drives duration. Do NOT clamp to maxSceneDurationMs — that
      // would chop the voiceover.
      return audio.durationMs + pacingRules.audioPaddingMs;
    }

    // Silent / estimated path: clamp using pacing-aware floor.
    const words = scene.narration.split(/\s+/).length;
    const estimated = (words / 150) * 60 * 1000 + pacingRules.defaultPaddingMs;
    const sceneFloor = Math.min(
      pacingRules.minSceneDurationMs,
      PACING_MIN_MS[scene.pacing] ?? pacingRules.minSceneDurationMs
    );
    return Math.max(sceneFloor, Math.min(pacingRules.maxSceneDurationMs, estimated));
  });

  const rawTotalMs = raw.reduce((a, b) => a + b, 0);
  console.info(
    `[render] Pre-enforce per-scene ms: [${raw.join(", ")}] total=${rawTotalMs}ms (${(rawTotalMs / 1000).toFixed(2)}s)`
  );

  const enforced = enforceTotalDuration(raw);
  const enforcedTotalMs = enforced.reduce((a, b) => a + b, 0);
  console.info(
    `[render] Post-enforce per-scene ms: [${enforced.join(", ")}] total=${enforcedTotalMs}ms (${(enforcedTotalMs / 1000).toFixed(2)}s)`
  );

  return enforced;
}

/**
 * If the timeline total falls outside [MIN_DURATION_MS, MAX_DURATION_MS],
 * scale every scene proportionally to land at TARGET_DURATION_MS.
 *
 * Scaling preserves the ratio between scenes, which keeps audio aligned
 * to scene boundaries (audio plays inside its own Sequence, so a longer
 * Sequence just adds trailing visual; a shorter one chops audio — we only
 * ever scale UP for the silent path. For the audio path we extend the last
 * scene rather than scaling, so we never cut audio off.)
 */
function enforceTotalDuration(durationsMs: number[]): number[] {
  const total = durationsMs.reduce((a, b) => a + b, 0);
  if (total >= MIN_DURATION_MS && total <= MAX_DURATION_MS) return durationsMs;

  if (total < MIN_DURATION_MS) {
    // Extend the last scene to hit the 60s target. This adds trailing visual
    // but does not corrupt any audio that is shorter than its scene.
    const padding = TARGET_DURATION_MS - total;
    const out = [...durationsMs];
    out[out.length - 1] = (out[out.length - 1] ?? 0) + padding;
    console.info(
      `[render] Total ${total}ms below floor; padded last scene by ${padding}ms → ${TARGET_DURATION_MS}ms target`
    );
    return out;
  }

  // total > MAX: scale every scene down to TARGET, preserving ratios.
  // Note: when audio drives a scene, scaling down can truncate it. We
  // accept this only when the timeline overruns the 62s ceiling — better to
  // fit than to overrun. Long overruns indicate the script is too long;
  // the script validator surfaces this earlier.
  const scale = TARGET_DURATION_MS / total;
  const out = durationsMs.map((d) => Math.max(2000, Math.round(d * scale)));
  console.info(
    `[render] Total ${total}ms above ceiling; scaled scenes by ${scale.toFixed(3)} → ${TARGET_DURATION_MS}ms target`
  );
  return out;
}

export function buildInputProps(job: RenderJob): ShortFormVideoProps {
  const durations = computeSceneDurations(job);
  const fps = 30;

  let frameOffset = 0;
  const scenesWithTiming: SceneWithTiming[] = job.scenes.map((scene, i) => {
    const durationMs = durations[i];
    const durationFrames = Math.ceil((durationMs / 1000) * fps);
    const startFrame = frameOffset;
    frameOffset += durationFrames;
    return { ...scene, startFrame, durationFrames };
  });

  const totalFrames = frameOffset;
  const totalMs = Math.round((totalFrames / fps) * 1000);
  console.info(
    `[render] Timeline: ${job.scenes.length} scenes, ${totalFrames} frames, ${totalMs}ms total`
  );

  const captionEntries = buildCaptionEntries(
    job.scenes,
    job.audioResults,
    job.styleProfile.captionStyle.maxWordsPerGroup,
    durations
  );

  // Remotion's renderer rejects file:// URLs (4.x). Rewrite every cached
  // audio path to the http://localhost:PORT/audio-cache/<basename> URL
  // served by Express. Files outside the audio cache (e.g. an absolute
  // path some other adapter produced) get returned unchanged and may
  // still fail — but those are out-of-band cases, not the default path.
  const port = Number(process.env.PORT ?? 3001);
  const audioBaseUrl = `http://localhost:${port}/audio-cache`;
  const audioResults = job.audioResults.map((a) => {
    if (!a.path || a.provider === "silent") return a;
    if (a.path.startsWith("http")) return a;
    const basename = path.basename(a.path);
    return { ...a, path: `${audioBaseUrl}/${basename}` };
  });

  // Same treatment for music URLs that come back as a local file path.
  let musicUrl = job.musicUrl ?? null;
  if (musicUrl && !musicUrl.startsWith("http") && !musicUrl.startsWith("file://")) {
    musicUrl = `${audioBaseUrl}/${path.basename(musicUrl)}`;
  }

  return {
    scenes: job.scenes,
    scenesWithTiming,
    resolvedAssets: job.resolvedAssets,
    audioResults,
    captionEntries,
    styleProfile: job.styleProfile,
    audioEnabled: job.audioEnabled,
    musicUrl,
    totalFrames,
  };
}

export async function bundleCompositions(): Promise<string> {
  if (cachedBundlePath && fs.existsSync(cachedBundlePath)) {
    return cachedBundlePath;
  }

  // Dynamic import to avoid loading Remotion renderer at module init time
  const { bundle } = await import("@remotion/bundler");

  const entryPoint = path.join(process.cwd(), "src", "remotion", "Root.tsx");

  console.info("[render] Bundling Remotion compositions...");
  const bundleLocation = await bundle({
    entryPoint,
    onProgress: (p) => {
      if (p % 20 === 0) console.info(`[render] Bundle progress: ${p}%`);
    },
  });

  cachedBundlePath = bundleLocation;
  console.info(`[render] Bundle complete: ${bundleLocation}`);
  return bundleLocation;
}

export async function renderVideo(
  job: RenderJob,
  onProgress: (pct: number) => void
): Promise<void> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  const bundlePath = await bundleCompositions();
  const inputProps = buildInputProps(job);

  fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });

  const composition = await selectComposition({
    serveUrl: bundlePath,
    id: "ShortFormVideo",
    inputProps,
  });

  console.info(`[render] Rendering ${inputProps.totalFrames} frames → ${job.outputPath}`);

  await renderMedia({
    composition,
    serveUrl: bundlePath,
    codec: "h264",
    outputLocation: job.outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      onProgress(pct);
    },
    timeoutInMilliseconds: 300_000,
    chromiumOptions: { disableWebSecurity: true },
    overwrite: true,
    concurrency: Math.max(1, Math.floor(require("os").cpus().length / 2)),
  });

  console.info(`[render] Done: ${job.outputPath}`);
}
