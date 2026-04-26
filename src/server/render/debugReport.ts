import fs from "fs";
import { RenderJob } from "../../lib/validation/schemas";
import { ExportValidation } from "./exportValidator";

/**
 * Per-job debug report. Written to OUTPUT_DIR/{jobId}.report.json so any
 * failed render leaves a complete trail of measurements and fallbacks.
 */
export interface DebugReport {
  jobId: string;
  createdAt: number;
  status: RenderJob["status"];
  errorMessage: string | null;
  scriptWordCount: number;
  voiceoverDurationMs: number;
  finalVideoDurationSeconds: number | null;
  sceneCount: number;
  visualAssetsCount: number;
  visualAssetsByProvider: Record<string, number>;
  ttsProvidersUsed: string[];
  captionCount: number;
  fallbacksUsed: string[];
  outputPath: string;
  srtPath: string;
  audioEnabled: boolean;
  validation: ExportValidation | null;
  validationPass: boolean | null;
}

export function buildDebugReport(
  job: RenderJob,
  captionCount: number,
  validation: ExportValidation | null
): DebugReport {
  const scriptWordCount = job.scenes.reduce(
    (sum, s) => sum + s.narration.trim().split(/\s+/).filter(Boolean).length,
    0
  );

  const voiceoverDurationMs = job.audioResults.reduce(
    (sum, a) => sum + (a.durationMs ?? 0),
    0
  );

  const visualAssetsByProvider: Record<string, number> = {};
  for (const asset of job.resolvedAssets) {
    visualAssetsByProvider[asset.provider] =
      (visualAssetsByProvider[asset.provider] ?? 0) + 1;
  }

  const ttsProvidersUsed = [...new Set(job.audioResults.map((a) => a.provider))];

  const fallbacksUsed: string[] = [];
  if (visualAssetsByProvider.generated > 0) {
    fallbacksUsed.push(`SVG card fallback used for ${visualAssetsByProvider.generated} scene(s)`);
  }
  if (job.audioEnabled && ttsProvidersUsed.includes("silent")) {
    const silentCount = job.audioResults.filter((a) => a.provider === "silent").length;
    fallbacksUsed.push(`Silent audio fallback used for ${silentCount} scene(s)`);
  }
  if (validation && !validation.pass) {
    fallbacksUsed.push("Export validation reported issues — see validation.failures");
  }

  return {
    jobId: job.jobId,
    createdAt: job.createdAt,
    status: job.status,
    errorMessage: job.errorMessage,
    scriptWordCount,
    voiceoverDurationMs,
    finalVideoDurationSeconds: validation?.durationSeconds ?? null,
    sceneCount: job.scenes.length,
    visualAssetsCount: job.resolvedAssets.length,
    visualAssetsByProvider,
    ttsProvidersUsed,
    captionCount,
    fallbacksUsed,
    outputPath: job.outputPath,
    srtPath: job.srtPath,
    audioEnabled: job.audioEnabled,
    validation,
    validationPass: validation?.pass ?? null,
  };
}

export function writeDebugReport(reportPath: string, report: DebugReport): void {
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.info(`[render:${report.jobId}] Debug report written to ${reportPath}`);
  } catch (err) {
    console.warn(`[render:${report.jobId}] Failed to write debug report: ${err}`);
  }
}
