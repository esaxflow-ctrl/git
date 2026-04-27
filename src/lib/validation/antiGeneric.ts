import { ScenePlan } from "./schemas";

const GENERIC_TERM_BLOCKLIST = new Set([
  "nature", "city", "people", "business", "technology", "abstract",
  "background", "texture", "lifestyle", "travel", "landscape", "sunset",
  "sky", "water", "forest", "urban", "office", "team", "success",
  "motivation", "inspiration", "beauty", "fashion", "food", "sport",
  "music", "art", "design", "work", "life", "world", "man", "woman",
  "girl", "boy", "person", "hands", "face", "happy", "sad", "love",
  "money", "time", "good", "bad", "big", "small", "new", "old",
  "light", "dark", "color", "black", "white", "red", "blue", "green",
  "house", "home", "car", "road", "street", "building", "door", "window",
  "tree", "flower", "animal", "dog", "cat", "bird",
]);

// Shot/camera descriptor words that add no semantic content on their own
const SHOT_DESCRIPTOR_WORDS = new Set([
  "close", "up", "extreme", "wide", "shot", "medium", "overhead", "angle",
  "view", "cinematic", "moody", "dramatic", "editorial", "style", "warm",
  "cool", "lighting", "composition", "framing", "natural", "candid",
  "tracking", "follow", "portrait", "landscape", "aerial", "establishing",
]);

export interface TermScore {
  term: string;
  score: number; // 0–10
  reason: string;
}

// Score a single search term for specificity. Returns 0–10.
function scoreSingleTerm(term: string): TermScore {
  const words = term.trim().split(/\s+/);
  let score = 0;
  const reasons: string[] = [];

  // Reward multi-word phrases
  if (words.length >= 5) { score += 4; reasons.push("long specific phrase"); }
  else if (words.length >= 3) { score += 3; reasons.push("multi-word phrase"); }
  else if (words.length === 2) { score += 2; reasons.push("two-word term"); }
  else { score += 1; reasons.push("single word"); }

  // Penalise generic words in the phrase
  const genericCount = words.filter((w) => GENERIC_TERM_BLOCKLIST.has(w.toLowerCase())).length;
  if (genericCount > 0) {
    score -= genericCount * 2;
    reasons.push(`${genericCount} generic word(s)`);
  }

  // Penalise phrases that are only shot descriptors
  const contentWords = words.filter(
    (w) => !SHOT_DESCRIPTOR_WORDS.has(w.toLowerCase()) && !GENERIC_TERM_BLOCKLIST.has(w.toLowerCase())
  );
  if (contentWords.length === 0) {
    score -= 4;
    reasons.push("no content words (only shot descriptors)");
  } else if (contentWords.length < words.length / 2) {
    score -= 2;
    reasons.push("mostly shot descriptors");
  }

  // Reward concrete nouns (heuristic: capitalised mid-phrase, or known concrete words)
  if (/[A-Z]/.test(term.slice(1))) {
    score += 1;
    reasons.push("contains proper noun");
  }

  const finalScore = Math.max(0, Math.min(10, score));
  return { term, score: finalScore, reason: reasons.join("; ") };
}

export function scoreSearchTerms(terms: string[]): { avgScore: number; scores: TermScore[]; weak: string[] } {
  const scores = terms.map(scoreSingleTerm);
  const weak = scores.filter((s) => s.score <= 2).map((s) => s.term);
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / (scores.length || 1);
  return { avgScore, scores, weak };
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  warnings: string[];
}

export function validateSearchTerms(terms: string[]): ValidationResult {
  const warnings: string[] = [];
  for (const term of terms) {
    const lower = term.toLowerCase().trim();
    if (lower.length < 4) {
      return {
        valid: false,
        reason: `Search term "${term}" is too short (min 4 chars). Use specific descriptive terms.`,
        warnings,
      };
    }
    if (GENERIC_TERM_BLOCKLIST.has(lower)) {
      return {
        valid: false,
        reason: `Search term "${term}" is too generic. Replace with something specific to this scene.`,
        warnings,
      };
    }
  }
  return { valid: true, warnings };
}

export function validateScenePlan(scenes: ScenePlan[]): ValidationResult {
  const warnings: string[] = [];

  if (scenes.length === 0) {
    return { valid: false, reason: "Scene plan is empty.", warnings };
  }

  // Visual mode diversity: stockImage / stockVideo can be 100% (every photo
  // is unique, variety comes from the search terms). SVG card modes are
  // capped at 60% because identical templates DO repeat visually.
  const modeCounts: Record<string, number> = {};
  for (const scene of scenes) {
    modeCounts[scene.visualMode] = (modeCounts[scene.visualMode] ?? 0) + 1;
  }
  for (const [mode, count] of Object.entries(modeCounts)) {
    const isUniquePhotoMode = mode === "stockImage" || mode === "stockVideo";
    if (isUniquePhotoMode) continue;
    const cap = 0.6;
    if (count / scenes.length > cap) {
      return {
        valid: false,
        reason: `Visual mode "${mode}" used in ${count}/${scenes.length} scenes (>${Math.round(cap * 100)}%). Vary visual modes more.`,
        warnings,
      };
    }
  }

  // Check search term specificity
  for (const scene of scenes) {
    const termResult = validateSearchTerms(scene.searchTerms);
    if (!termResult.valid) {
      return { valid: false, reason: termResult.reason, warnings };
    }
  }

  // Check visual role diversity
  const roles = new Set(scenes.map((s) => s.visualRole));
  if (roles.size < Math.min(3, scenes.length)) {
    return {
      valid: false,
      reason: `Only ${roles.size} distinct visual roles across ${scenes.length} scenes. Need at least 3.`,
      warnings,
    };
  }

  // Soft warnings
  const allSamePacing = new Set(scenes.map((s) => s.pacing)).size === 1;
  if (allSamePacing) {
    warnings.push("All scenes have identical pacing. Consider varying pace for more dynamic output.");
  }

  // Check for near-threshold mode dominance
  for (const [mode, count] of Object.entries(modeCounts)) {
    if (count / scenes.length > 0.45) {
      warnings.push(`Visual mode "${mode}" appears in ${count}/${scenes.length} scenes. Consider more variety.`);
    }
  }

  return { valid: true, warnings };
}

export function detectVisualRepetition(scenes: ScenePlan[]): string[] {
  const warnings: string[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1];
    const curr = scenes[i];
    if (prev.visualMode === curr.visualMode) {
      const sharedTerms = prev.searchTerms.filter((t) =>
        curr.searchTerms.includes(t)
      );
      if (sharedTerms.length > 0) {
        warnings.push(
          `Scenes ${i} and ${i + 1} share mode "${curr.visualMode}" and terms [${sharedTerms.join(", ")}]. They may look similar.`
        );
      }
    }
  }
  return warnings;
}

export function pacingVarianceCheck(scenes: ScenePlan[]): string[] {
  const warnings: string[] = [];
  const pacingValues = scenes.map((s) => s.pacing);
  const unique = new Set(pacingValues);
  if (unique.size === 1) {
    warnings.push(`All ${scenes.length} scenes use pacing "${pacingValues[0]}". Add variety for more engaging output.`);
  }
  return warnings;
}
