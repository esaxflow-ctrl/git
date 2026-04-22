import path from "path";
import fs from "fs";
import {
  RenderJob,
  ShortFormVideoProps,
  SceneWithTiming,
} from "../../lib/validation/schemas";
import { buildCaptionEntries } from "../../lib/captions";

let cachedBundlePath: string | null = null;

function computeSceneDurations(job: RenderJob): number[] {
  const { scenes, audioResults, styleProfile, audioEnabled } = job;
  const { pacingRules } = styleProfile;

  return scenes.map((scene, i) => {
    const audio = audioResults[i];
    if (audioEnabled && audio && audio.provider !== "silent" && audio.durationMs > 0) {
      return audio.durationMs + pacingRules.audioPaddingMs;
    }
    const words = scene.narration.split(/\s+/).length;
    const estimated = (words / 150) * 60 * 1000 + pacingRules.defaultPaddingMs;
    return Math.max(
      pacingRules.minSceneDurationMs,
      Math.min(pacingRules.maxSceneDurationMs, estimated)
    );
  });
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

  const captionEntries = buildCaptionEntries(
    job.scenes,
    job.audioResults,
    job.styleProfile.captionStyle.maxWordsPerGroup
  );

  return {
    scenes: job.scenes,
    scenesWithTiming,
    resolvedAssets: job.resolvedAssets,
    audioResults: job.audioResults,
    captionEntries,
    styleProfile: job.styleProfile,
    audioEnabled: job.audioEnabled,
    musicUrl: job.musicUrl ?? null,
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
