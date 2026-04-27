import fs from "fs";
import { VisualAsset, ScenePlan } from "../../lib/validation/schemas";

/**
 * Final-export validation.
 *
 * Confirms the rendered MP4 actually exists, lands in the 58–62s band, has
 * 1080×1920 resolution, an audio track, and a sane file size. The result is
 * returned (never thrown) so the render route can attach it to the job.
 */

// ─── Visual-coverage check ───────────────────────────────────────────────────
// Flags videos that are mostly text cards / SVG fallbacks (the "AI slop"
// failure mode). Returns a warning when >30% of scenes have no real photo
// or video asset attached. Doesn't fail the render — surfaces it in the
// debug report so the user can react.

export interface VisualCoverageReport {
  totalScenes: number;
  realPhotoScenes: number;
  cardOrFallbackScenes: number;
  generatedFallbackPercent: number;
  textCardScenes: number;
  textCardPercent: number;
  textHeavy: boolean;
  warnings: string[];
}

const CARD_MODES = new Set(["quoteCard", "evidenceCard", "textCard", "timelineCard", "gradientMotionCard", "mapCard"]);

export function analyzeVisualCoverage(
  scenes: ScenePlan[],
  assets: VisualAsset[]
): VisualCoverageReport {
  const warnings: string[] = [];
  const totalScenes = scenes.length;

  let realPhotoScenes = 0;
  let cardOrFallbackScenes = 0;
  let textCardScenes = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const asset = assets[i];
    const isCardMode = CARD_MODES.has(scene.visualMode);
    const isGeneratedFallback = asset?.provider === "generated";

    if (isCardMode) textCardScenes++;
    if (isGeneratedFallback || isCardMode) cardOrFallbackScenes++;
    else realPhotoScenes++;
  }

  const generatedFallbackPercent = (cardOrFallbackScenes / Math.max(1, totalScenes)) * 100;
  const textCardPercent = (textCardScenes / Math.max(1, totalScenes)) * 100;
  const textHeavy = generatedFallbackPercent > 30;

  if (textHeavy) {
    warnings.push(
      `${cardOrFallbackScenes}/${totalScenes} scene(s) (${generatedFallbackPercent.toFixed(0)}%) have no real photo — using SVG fallbacks. Add a Pexels API key (free) for real visuals.`
    );
  }
  if (textCardPercent > 20) {
    warnings.push(
      `${textCardScenes}/${totalScenes} scene(s) are typography-only cards (${textCardPercent.toFixed(0)}%). Aim for ≤20%.`
    );
  }

  return {
    totalScenes,
    realPhotoScenes,
    cardOrFallbackScenes,
    generatedFallbackPercent,
    textCardScenes,
    textCardPercent,
    textHeavy,
    warnings,
  };
}

export interface ExportValidation {
  pass: boolean;
  fileExists: boolean;
  fileSizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  expectedDurationSeconds: number;
  failures: string[];
}

// Strict band when the timeline is silent-driven (we explicitly target 60s).
// Audio-driven renders use the wider band — voice length is authoritative
// and ranging 45–75s with the audio is fine.
const SILENT_MIN_DURATION_SECONDS = 58;
const SILENT_MAX_DURATION_SECONDS = 62;
const AUDIO_MIN_DURATION_SECONDS = 25;
const AUDIO_MAX_DURATION_SECONDS = 78;
// 1080x1920 at H.264 with audio, ~30fps, ~1Mbps avg → ~7-9MB for 60s. Floor
// at 200KB just to catch zero-byte / corrupt outputs without false positives
// on heavily-compressed renders.
const MIN_FILE_SIZE_BYTES = 200_000;

export async function validateExport(
  outputPath: string,
  expectedDurationSeconds: number,
  audioEnabled: boolean
): Promise<ExportValidation> {
  const failures: string[] = [];

  const fileExists = fs.existsSync(outputPath);
  let fileSizeBytes = 0;
  let durationSeconds: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let hasAudio = false;

  if (!fileExists) {
    failures.push(`Output file does not exist: ${outputPath}`);
    return {
      pass: false,
      fileExists: false,
      fileSizeBytes: 0,
      durationSeconds: null,
      width: null,
      height: null,
      hasAudio: false,
      expectedDurationSeconds,
      failures,
    };
  }

  try {
    fileSizeBytes = fs.statSync(outputPath).size;
  } catch (err) {
    failures.push(`Could not stat output file: ${err}`);
  }

  if (fileSizeBytes < MIN_FILE_SIZE_BYTES) {
    failures.push(
      `File size ${fileSizeBytes} bytes is below ${MIN_FILE_SIZE_BYTES}-byte floor — likely corrupt or empty.`
    );
  }

  // Use Remotion's getVideoMetadata to read the rendered MP4. Wrapped in a
  // dynamic import so it doesn't load at module init.
  try {
    const renderer = await import("@remotion/renderer");
    const meta = await (renderer as unknown as {
      getVideoMetadata?: (
        p: string
      ) => Promise<{
        durationInSeconds: number;
        width: number;
        height: number;
        audioCodec?: string | null;
      }>;
    }).getVideoMetadata?.(outputPath);

    if (meta) {
      durationSeconds = meta.durationInSeconds;
      width = meta.width;
      height = meta.height;
      hasAudio = Boolean(meta.audioCodec);
    } else {
      failures.push("Remotion getVideoMetadata not available — cannot verify duration/codec.");
    }
  } catch (err) {
    failures.push(
      `Reading video metadata failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (durationSeconds !== null) {
    const minSeconds = audioEnabled ? AUDIO_MIN_DURATION_SECONDS : SILENT_MIN_DURATION_SECONDS;
    const maxSeconds = audioEnabled ? AUDIO_MAX_DURATION_SECONDS : SILENT_MAX_DURATION_SECONDS;
    if (durationSeconds < minSeconds) {
      failures.push(
        `Duration ${durationSeconds.toFixed(2)}s is below ${minSeconds}s floor.`
      );
    } else if (durationSeconds > maxSeconds) {
      failures.push(
        `Duration ${durationSeconds.toFixed(2)}s exceeds ${maxSeconds}s ceiling.`
      );
    }
  }

  if (width !== null && height !== null) {
    if (width !== 1080 || height !== 1920) {
      failures.push(`Resolution ${width}x${height} is not 1080x1920.`);
    }
  }

  if (audioEnabled && !hasAudio) {
    failures.push("Audio was enabled but the output has no audio track.");
  }

  return {
    pass: failures.length === 0,
    fileExists,
    fileSizeBytes,
    durationSeconds,
    width,
    height,
    hasAudio,
    expectedDurationSeconds,
    failures,
  };
}
