import { ScenePlan, VisualAsset, AudioResult } from "./validation/schemas";
import { scoreSearchTerms } from "./validation/antiGeneric";

// 7-dimension slop detector. All scores are 0–100.
// `overallScoreOutOf10` is the user-facing 1–10 brief score.
// `revisionsNeeded` lists the dimensions to fix when the score is below 80.
export interface QualityDimensions {
  hookStrength: number;
  scriptOriginality: number;
  visualSpecificity: number;
  captionReadability: number;
  voiceoverPacing: number;
  sceneVariety: number;
  retentionPotential: number;
}

export interface QualityReport {
  overallScore: number; // 0-100
  overallScoreOutOf10: number; // 1-10
  dimensions: QualityDimensions;
  warnings: string[];
  blockers: string[];
  revisionsNeeded: string[];
  grade: "A" | "B" | "C" | "D" | "F";
}

const GENERIC_OPENERS: RegExp[] = [
  /^did\s+you\s+know\b/i,
  /^here'?s\s+(?:why|what|how|the)/i,
  /^hey\s+(?:guys|everyone|friends)/i,
  /^let\s+me\s+tell\s+you/i,
  /^so\s+basically\b/i,
  /^in\s+today'?s\s+video/i,
  /^welcome\s+(?:back\s+)?to/i,
  /^ever\s+wonder(?:ed)?\b/i,
  /^you\s+won'?t\s+believe/i,
];

const FILLER_PHRASES = [
  "game-changer",
  "level up",
  "unlock the secret",
  "harness the power",
  "fast-paced world",
  "next level",
  "but wait, there's more",
];

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function gradeFromScore(score: number): QualityReport["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function scoreHookStrength(scenes: ScenePlan[], warnings: string[]): number {
  if (scenes.length === 0) return 0;
  const hook = scenes[0].narration.trim();
  const words = hook.split(/\s+/).filter(Boolean);
  const seconds = (words.length / 150) * 60;

  let score = 90;

  if (seconds > 3.0) {
    score -= 30;
    warnings.push(`Hook is ~${seconds.toFixed(1)}s — cut to ≤2.5s for retention.`);
  } else if (seconds > 2.5) {
    score -= 12;
  }

  for (const pattern of GENERIC_OPENERS) {
    if (pattern.test(hook)) {
      score -= 50;
      warnings.push(`Hook starts with a banned generic phrase. Rewrite the first line.`);
      break;
    }
  }

  // Reward concrete language: presence of a concrete noun or number
  if (/\b\d+\b/.test(hook)) score += 4;
  if (/[A-Z]/.test(hook.slice(1))) score += 2;

  return clamp(score);
}

function scoreScriptOriginality(scenes: ScenePlan[], warnings: string[]): number {
  const fullText = scenes.map((s) => s.narration).join(" ").toLowerCase();
  let score = 90;
  let hits = 0;
  for (const phrase of FILLER_PHRASES) {
    if (fullText.includes(phrase)) {
      hits++;
    }
  }
  if (hits > 0) {
    score -= hits * 15;
    warnings.push(`Script contains ${hits} cliché phrase(s) (e.g. "${FILLER_PHRASES[0]}", "level up"). Rewrite.`);
  }

  // Trigram repetition penalty
  const words = fullText.replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const seen = new Map<string, number>();
  for (let i = 0; i < words.length - 3; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (trigram.split(" ").every((w) => w.length <= 3)) continue;
    seen.set(trigram, (seen.get(trigram) ?? 0) + 1);
  }
  const dupes = [...seen.values()].filter((c) => c >= 2).length;
  if (dupes > 0) {
    score -= dupes * 8;
    warnings.push(`${dupes} repeated 3-word phrase(s) in script. Vary the language.`);
  }

  return clamp(score);
}

function scoreVisualSpecificity(
  scenes: ScenePlan[],
  resolvedAssets: VisualAsset[] | null,
  warnings: string[],
  blockers: string[]
): number {
  const allTerms = scenes.flatMap((s) => s.searchTerms);
  const { avgScore, weak } = scoreSearchTerms(allTerms);

  let score = Math.round((avgScore / 10) * 100);
  if (weak.length > 0) {
    warnings.push(
      `${weak.length} weak search term(s): ${weak.slice(0, 3).map((t) => `"${t}"`).join(", ")}${weak.length > 3 ? "…" : ""}`
    );
    score = Math.max(10, score - weak.length * 8);
  }
  if (avgScore < 2) {
    blockers.push("Search terms are too generic — visuals will be poor quality.");
  }

  if (resolvedAssets) {
    const failed = resolvedAssets.filter((a) => !a.url && !a.svgData).length;
    if (failed > 0) {
      warnings.push(`${failed} scene(s) have no visual asset resolved.`);
      score = Math.max(0, score - failed * 15);
    }
  }

  return clamp(score);
}

function scoreCaptionReadability(scenes: ScenePlan[], warnings: string[]): number {
  const avgWords = scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0) / scenes.length;
  let score = 90;
  if (avgWords < 8) {
    score = 45;
    warnings.push("Very short narrations per scene — captions may flash too briefly.");
  } else if (avgWords > 35) {
    score = 60;
    warnings.push("Long narrations per scene — captions may feel dense.");
  }

  // Long captions hurt readability
  const longCaptions = scenes.filter((s) => s.caption.length > 70).length;
  if (longCaptions > 0) {
    score -= longCaptions * 8;
    warnings.push(`${longCaptions} caption(s) over 70 chars — shorten for native feel.`);
  }
  return clamp(score);
}

function scoreVoiceoverPacing(
  audioResults: AudioResult[] | null,
  warnings: string[],
  blockers: string[]
): number {
  if (!audioResults) {
    warnings.push("Audio not synthesized — video will be silent.");
    return 30;
  }
  const silent = audioResults.filter((a) => a.provider === "silent" || a.durationMs === 0).length;
  if (silent === audioResults.length) {
    blockers.push("All audio is silent — check TTS configuration.");
    return 10;
  }
  const totalMs = audioResults.reduce((sum, a) => sum + a.durationMs, 0);
  let score = 90;

  if (silent > 0) {
    score -= silent * 12;
    warnings.push(`${silent} scene(s) have silent audio.`);
  }
  if (totalMs < 55_000) {
    score -= 25;
    warnings.push(`Voiceover is ${(totalMs / 1000).toFixed(1)}s — below 58s floor for 60s target.`);
  } else if (totalMs > 65_000) {
    score -= 25;
    warnings.push(`Voiceover is ${(totalMs / 1000).toFixed(1)}s — above 62s ceiling.`);
  } else if (totalMs >= 58_000 && totalMs <= 62_000) {
    score = 100;
  }
  return clamp(score);
}

// Variety score is content-driven now, not mode-driven. With every scene a
// real (different) photo, the question is whether the photos look distinct
// from each other — which Openverse / Pexels delivers based on unique
// search terms. So variety = unique search terms across scenes + pacing
// variation, not "did you use 3 different visual modes".
function scoreSceneVariety(scenes: ScenePlan[], warnings: string[], _blockers: string[]): number {
  let score = 100;

  // Search-term uniqueness across scenes. Each scene contributes its
  // primary term; we want most of them to be distinct.
  const primaryTerms = scenes
    .map((s) => (s.searchTerms[0] ?? "").toLowerCase().trim())
    .filter(Boolean);
  const distinctTerms = new Set(primaryTerms).size;
  const termRatio = distinctTerms / Math.max(1, primaryTerms.length);
  if (termRatio < 0.5) {
    score -= 30;
    warnings.push(`Only ${distinctTerms}/${primaryTerms.length} unique primary search terms — visuals will repeat.`);
  } else if (termRatio < 0.7) {
    score -= 15;
    warnings.push(`Some scenes share search terms — consider varying.`);
  }

  // Scene-count check for retention pacing (12+ scenes for 60s ≈ ~5s avg).
  if (scenes.length < 8) {
    score -= 25;
    warnings.push(`Only ${scenes.length} scenes — short-form retention prefers 12+ scene cuts per 60s.`);
  } else if (scenes.length < 10) {
    score -= 10;
    warnings.push(`${scenes.length} scenes — could use more cuts for snappier pacing.`);
  }

  // Pacing variation.
  const pacingSet = new Set(scenes.map((s) => s.pacing));
  if (pacingSet.size === 1) {
    score -= 20;
    warnings.push("All scenes use identical pacing.");
  } else if (pacingSet.size >= 3) {
    score += 5;
  }

  // Card-mode check: SVG card templates DO repeat visually, so cap them.
  const cardCount = scenes.filter((s) =>
    ["quoteCard", "evidenceCard", "textCard", "timelineCard", "gradientMotionCard", "mapCard"].includes(s.visualMode)
  ).length;
  if (cardCount / scenes.length > 0.2) {
    score -= 20;
    warnings.push(`${cardCount}/${scenes.length} scenes are typography cards — replace with photo scenes.`);
  }

  return clamp(score);
}

function scoreRetentionPotential(
  scenes: ScenePlan[],
  audioResults: AudioResult[] | null
): number {
  let score = 75;

  // Hook present + short
  const hookWords = scenes[0]?.narration.split(/\s+/).length ?? 0;
  if (hookWords > 0 && hookWords <= 8) score += 10;
  else if (hookWords > 14) score -= 12;

  // Variety
  const distinctModes = new Set(scenes.map((s) => s.visualMode)).size;
  if (distinctModes >= 4) score += 8;

  // Hits the 60s window
  if (audioResults) {
    const totalMs = audioResults.reduce((sum, a) => sum + a.durationMs, 0);
    if (totalMs >= 58_000 && totalMs <= 62_000) score += 10;
    else if (totalMs < 50_000 || totalMs > 70_000) score -= 15;
  }

  // Has emphasis words → drives caption highlights
  const totalEmphasis = scenes.reduce((sum, s) => sum + s.emphasisWords.length, 0);
  if (totalEmphasis >= scenes.length) score += 4;

  // Dramatic pause anywhere boosts retention
  if (scenes.some((s) => s.pacing === "dramatic_pause")) score += 4;

  return clamp(score);
}

export function analyzeQuality(
  scenes: ScenePlan[],
  resolvedAssets: VisualAsset[] | null,
  audioResults: AudioResult[] | null
): QualityReport {
  const warnings: string[] = [];
  const blockers: string[] = [];

  const dimensions: QualityDimensions = {
    hookStrength: scoreHookStrength(scenes, warnings),
    scriptOriginality: scoreScriptOriginality(scenes, warnings),
    visualSpecificity: scoreVisualSpecificity(scenes, resolvedAssets, warnings, blockers),
    captionReadability: scoreCaptionReadability(scenes, warnings),
    voiceoverPacing: scoreVoiceoverPacing(audioResults, warnings, blockers),
    sceneVariety: scoreSceneVariety(scenes, warnings, blockers),
    retentionPotential: scoreRetentionPotential(scenes, audioResults),
  };

  // Weighted overall — hook + visuals + retention carry the most weight.
  const overallScore = Math.round(
    dimensions.hookStrength * 0.18 +
    dimensions.scriptOriginality * 0.16 +
    dimensions.visualSpecificity * 0.18 +
    dimensions.captionReadability * 0.10 +
    dimensions.voiceoverPacing * 0.14 +
    dimensions.sceneVariety * 0.10 +
    dimensions.retentionPotential * 0.14
  );

  const overallScoreOutOf10 = Math.round(overallScore / 10);

  // Anything under 80/100 (8/10) is a "revise" signal per the brief.
  const REVISION_THRESHOLD = 80;
  const revisionsNeeded: string[] = [];
  for (const [name, value] of Object.entries(dimensions)) {
    if (value < REVISION_THRESHOLD) {
      revisionsNeeded.push(`${name} (${value}/100)`);
    }
  }

  return {
    overallScore,
    overallScoreOutOf10,
    dimensions,
    warnings,
    blockers,
    revisionsNeeded,
    grade: gradeFromScore(overallScore),
  };
}
