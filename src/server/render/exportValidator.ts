import fs from "fs";

/**
 * Final-export validation.
 *
 * Confirms the rendered MP4 actually exists, lands in the 58–62s band, has
 * 1080×1920 resolution, an audio track, and a sane file size. The result is
 * returned (never thrown) so the render route can attach it to the job.
 */

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

const MIN_DURATION_SECONDS = 58;
const MAX_DURATION_SECONDS = 62;
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
    if (durationSeconds < MIN_DURATION_SECONDS) {
      failures.push(
        `Duration ${durationSeconds.toFixed(2)}s is below ${MIN_DURATION_SECONDS}s floor.`
      );
    } else if (durationSeconds > MAX_DURATION_SECONDS) {
      failures.push(
        `Duration ${durationSeconds.toFixed(2)}s exceeds ${MAX_DURATION_SECONDS}s ceiling.`
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
