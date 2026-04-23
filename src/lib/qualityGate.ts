import { ScenePlan, VisualAsset, AudioResult } from "./validation/schemas";
import { scoreSearchTerms } from "./validation/antiGeneric";

export interface QualityDimensions {
  visualDiversity: number;   // 0–100
  searchTermQuality: number; // 0–100
  pacingVariety: number;     // 0–100
  captionCoverage: number;   // 0–100 (based on narration coverage estimate)
  audioReadiness: number;    // 0–100
}

export interface QualityReport {
  overallScore: number;
  dimensions: QualityDimensions;
  warnings: string[];
  blockers: string[];
  grade: "A" | "B" | "C" | "D" | "F";
}

function gradeFromScore(score: number): QualityReport["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function analyzeQuality(
  scenes: ScenePlan[],
  resolvedAssets: VisualAsset[] | null,
  audioResults: AudioResult[] | null
): QualityReport {
  const warnings: string[] = [];
  const blockers: string[] = [];

  // ── Visual diversity (0–100) ──────────────────────────────────────────────
  const modeCounts: Record<string, number> = {};
  for (const s of scenes) modeCounts[s.visualMode] = (modeCounts[s.visualMode] ?? 0) + 1;
  const distinctModes = Object.keys(modeCounts).length;
  const maxModeRatio = Math.max(...Object.values(modeCounts)) / scenes.length;

  let visualDiversity = 100;
  if (distinctModes === 1) { visualDiversity = 0; blockers.push("All scenes use the same visual mode."); }
  else if (distinctModes === 2) { visualDiversity = 40; warnings.push("Only 2 distinct visual modes across all scenes."); }
  else if (maxModeRatio > 0.75) { visualDiversity = 55; warnings.push("One visual mode dominates (>75% of scenes)."); }
  else if (maxModeRatio > 0.60) { visualDiversity = 70; }

  // Check for consecutive photo runs
  let maxConsecutivePhoto = 0;
  let run = 0;
  for (const s of scenes) {
    if (s.visualMode === "stockImage" || s.visualMode === "stockVideo") {
      run++;
      maxConsecutivePhoto = Math.max(maxConsecutivePhoto, run);
    } else {
      run = 0;
    }
  }
  if (maxConsecutivePhoto > 3) {
    warnings.push(`${maxConsecutivePhoto} consecutive photo scenes in a row — insert card scenes.`);
    visualDiversity = Math.max(0, visualDiversity - 20);
  }

  if (resolvedAssets) {
    const failedAssets = resolvedAssets.filter((a) => !a.url && !a.svgData).length;
    if (failedAssets > 0) {
      warnings.push(`${failedAssets} scene(s) have no visual asset resolved.`);
      visualDiversity = Math.max(0, visualDiversity - failedAssets * 15);
    }
  }

  // ── Search term quality (0–100) ───────────────────────────────────────────
  const allTerms = scenes.flatMap((s) => s.searchTerms);
  const { avgScore, weak } = scoreSearchTerms(allTerms);
  let searchTermQuality = Math.round((avgScore / 10) * 100);
  if (weak.length > 0) {
    warnings.push(`${weak.length} weak search term(s): ${weak.slice(0, 3).map((t) => `"${t}"`).join(", ")}${weak.length > 3 ? "…" : ""}`);
    searchTermQuality = Math.max(10, searchTermQuality - weak.length * 8);
  }
  if (avgScore < 2) blockers.push("Search terms are too generic — visuals will be poor quality.");

  // ── Pacing variety (0–100) ────────────────────────────────────────────────
  const pacingSet = new Set(scenes.map((s) => s.pacing));
  let pacingVariety: number;
  if (pacingSet.size >= 4) pacingVariety = 100;
  else if (pacingSet.size === 3) pacingVariety = 80;
  else if (pacingSet.size === 2) pacingVariety = 55;
  else { pacingVariety = 20; warnings.push("All scenes use identical pacing — vary pace for more energy."); }

  // Reward dramatic_pause for emotional depth
  if (scenes.some((s) => s.pacing === "dramatic_pause")) pacingVariety = Math.min(100, pacingVariety + 10);

  // ── Caption coverage (0–100) ──────────────────────────────────────────────
  // Estimate based on narration quality: short narrations risk short captions
  const avgNarrationWords = scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0) / scenes.length;
  let captionCoverage: number;
  if (avgNarrationWords >= 20) captionCoverage = 90;
  else if (avgNarrationWords >= 12) captionCoverage = 70;
  else { captionCoverage = 45; warnings.push("Very short narrations per scene — captions may flash too briefly."); }

  // ── Audio readiness (0–100) ───────────────────────────────────────────────
  let audioReadiness: number;
  if (!audioResults) {
    audioReadiness = 30;
    warnings.push("Audio not synthesized — video will be silent.");
  } else {
    const silentCount = audioResults.filter((a) => a.provider === "silent" || a.durationMs === 0).length;
    if (silentCount === audioResults.length) {
      audioReadiness = 10;
      blockers.push("All audio is silent — check TTS configuration.");
    } else if (silentCount > 0) {
      audioReadiness = 55;
      warnings.push(`${silentCount} scene(s) have silent audio.`);
    } else {
      const totalMs = audioResults.reduce((sum, a) => sum + a.durationMs, 0);
      if (totalMs < 30_000) {
        audioReadiness = 60;
        warnings.push("Total audio duration is very short (<30s). Script may be too brief.");
      } else {
        audioReadiness = 95;
      }
    }
  }

  const overallScore = Math.round(
    visualDiversity * 0.3 +
    searchTermQuality * 0.25 +
    pacingVariety * 0.15 +
    captionCoverage * 0.15 +
    audioReadiness * 0.15
  );

  return {
    overallScore,
    dimensions: { visualDiversity, searchTermQuality, pacingVariety, captionCoverage, audioReadiness },
    warnings,
    blockers,
    grade: gradeFromScore(overallScore),
  };
}
