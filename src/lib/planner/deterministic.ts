import { v4 as uuidv4 } from "uuid";
import {
  ScenePlan,
  VisualMode,
  PacingMode,
  VisualRole,
  PlannerOptions,
} from "../validation/schemas";

// Stopwords for noun extraction
const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","as","is","was","are","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might","must",
  "shall","can","need","dare","ought","used","it","its","this","that","these",
  "those","i","me","my","myself","we","our","ours","ourselves","you","your",
  "yours","yourself","he","him","his","himself","she","her","hers","herself",
  "they","them","their","theirs","themselves","what","which","who","whom",
  "when","where","why","how","all","both","each","few","more","most","other",
  "some","such","no","not","only","own","same","so","than","too","very","just",
  "about","above","after","again","against","also","although","always","among",
  "another","any","because","before","between","during","even","every","first",
  "found","get","give","go","going","had","here","if","into","know","let","like",
  "make","many","now","often","over","said","see","since","still","take","their",
  "them","then","there","through","under","until","up","upon","use","well",
  "whether","while","without","yet",
]);

const VISUAL_MODES: VisualMode[] = [
  "stockVideo",
  "stockImage",
  "gradientMotionCard",
  "quoteCard",
  "evidenceCard",
  "textCard",
  "timelineCard",
  "mapCard",
];

const PACING_PATTERN: PacingMode[] = [
  "fast", "medium", "slow", "fast", "medium", "dramatic_pause", "fast", "medium",
];

const ROLE_PATTERN: VisualRole[] = [
  "hook", "evidence", "evidence", "climax", "evidence", "climax", "resolution", "transition",
];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function groupSentences(sentences: string[], targetGroups: number): string[][] {
  if (sentences.length <= targetGroups) {
    return sentences.map((s) => [s]);
  }
  const groups: string[][] = [];
  const groupSize = Math.ceil(sentences.length / targetGroups);
  for (let i = 0; i < sentences.length; i += groupSize) {
    groups.push(sentences.slice(i, i + groupSize));
  }
  return groups;
}

function extractNouns(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] ?? 0) + 1;
  }

  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([w]) => w);
}

function extractEmphasisWords(text: string): string[] {
  const matches: string[] = [];
  // ALL CAPS words
  const capsMatches = text.match(/\b[A-Z]{2,}\b/g) ?? [];
  matches.push(...capsMatches.map((w) => w.toLowerCase()));
  // Words before punctuation emphasis
  const emphasisMatches = text.match(/\b\w+(?=[!?])/g) ?? [];
  matches.push(...emphasisMatches.map((w) => w.toLowerCase()));
  return [...new Set(matches)].slice(0, 4);
}

function estimateDurationHint(narration: string): number {
  const wordCount = narration.split(/\s+/).length;
  // ~150 words per minute
  return Math.max(4, Math.min(15, Math.round((wordCount / 150) * 60)));
}

function buildCaption(narration: string): string {
  const sentences = splitIntoSentences(narration);
  const first = sentences[0] ?? narration;
  // Keep it punchy: max 8 words
  const words = first.split(/\s+/).slice(0, 8);
  let caption = words.join(" ");
  if (!caption.endsWith(".") && !caption.endsWith("!") && !caption.endsWith("?")) {
    caption += ".";
  }
  return caption;
}

function assignVisualMode(index: number, usedModes: VisualMode[]): VisualMode {
  // Rotate through modes, never repeat the last one
  const last = usedModes[usedModes.length - 1];
  const candidates = VISUAL_MODES.filter((m) => m !== last);
  return candidates[index % candidates.length];
}

function inferMood(text: string, style: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("danger") || lower.includes("threat") || lower.includes("war")) return "tense";
  if (lower.includes("success") || lower.includes("win") || lower.includes("achieve")) return "triumphant";
  if (lower.includes("discover") || lower.includes("reveal") || lower.includes("secret")) return "mysterious";
  if (lower.includes("million") || lower.includes("billion") || lower.includes("market")) return "analytical";
  if (lower.includes("ancient") || lower.includes("history") || lower.includes("century")) return "historical";
  return "neutral";
}

export async function generateDeterministic(
  script: string,
  options: PlannerOptions
): Promise<ScenePlan[]> {
  const { minScenes, maxScenes, targetDurationSeconds } = options;

  const sentences = splitIntoSentences(script);

  // Aim for a number of scenes in range that targets ~duration
  const wordsTotal = script.split(/\s+/).length;
  const estimatedDuration = (wordsTotal / 150) * 60;
  const targetScenes = Math.round(
    Math.max(minScenes, Math.min(maxScenes, (estimatedDuration / targetDurationSeconds) * maxScenes))
  );
  const numScenes = Math.max(minScenes, Math.min(maxScenes, targetScenes));

  const groups = groupSentences(sentences, numScenes);
  const usedModes: VisualMode[] = [];
  const scenes: ScenePlan[] = [];

  for (let i = 0; i < groups.length; i++) {
    const narration = groups[i].join(" ");
    const visualMode = assignVisualMode(i, usedModes);
    usedModes.push(visualMode);

    const searchTerms = extractNouns(narration);
    // Ensure we always have at least 2 search terms
    if (searchTerms.length < 2) {
      searchTerms.push(extractNouns(script)[0] ?? "discovery");
    }

    scenes.push({
      id: uuidv4(),
      narration,
      caption: buildCaption(narration),
      searchTerms: searchTerms.slice(0, 3),
      visualMode,
      emphasisWords: extractEmphasisWords(narration),
      mood: inferMood(narration, options.style.id),
      sceneGoal: i === 0 ? "hook the viewer" : i === groups.length - 1 ? "resolve the narrative" : "develop the story",
      visualRole: ROLE_PATTERN[Math.min(i, ROLE_PATTERN.length - 1)],
      pacing: PACING_PATTERN[Math.min(i, PACING_PATTERN.length - 1)],
      durationHint: estimateDurationHint(narration),
    });
  }

  return scenes;
}
