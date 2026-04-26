import { ScenePlan, AudioResult, CaptionEntry, WordTiming } from "../validation/schemas";

export function estimateWordTimings(
  text: string,
  durationMs: number,
  offsetMs: number = 0
): WordTiming[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const timings: WordTiming[] = [];
  let currentMs = offsetMs;

  for (const word of words) {
    const proportion = word.length / totalChars;
    const wordDuration = durationMs * proportion;
    timings.push({
      word: word.replace(/[^a-zA-Z0-9']/g, ""),
      startMs: Math.round(currentMs),
      endMs: Math.round(currentMs + wordDuration),
    });
    currentMs += wordDuration;
  }

  return timings;
}

// Minimum time a caption must remain on screen (ms) for readability
const MIN_CAPTION_DURATION_MS = 800;
// Max words to prevent 3+ line wrap on a 9:16 portrait composition
const MAX_WORDS_CAP = 5;

export function groupWordTimings(
  wordTimings: WordTiming[],
  maxWordsPerGroup: number,
  emphasisWords: string[]
): CaptionEntry[] {
  if (wordTimings.length === 0) return [];

  const emphasisSet = new Set(emphasisWords.map((w) => w.toLowerCase()));
  // Enforce hard cap to prevent 3-line overflow
  const effectiveMax = Math.min(maxWordsPerGroup, MAX_WORDS_CAP);
  const entries: CaptionEntry[] = [];
  let i = 0;

  while (i < wordTimings.length) {
    const group: WordTiming[] = [];
    let breakAt = i;

    while (group.length < effectiveMax && breakAt < wordTimings.length) {
      group.push(wordTimings[breakAt]);
      breakAt++;

      const wordRaw = wordTimings[breakAt - 1].word;
      if (wordRaw && /[.!?,;]$/.test(wordRaw) && group.length >= 2) {
        break;
      }
    }

    const text = group.map((w) => w.word).join(" ");
    const entryEmphasis = group
      .map((w) => w.word.toLowerCase())
      .filter((w) => emphasisSet.has(w));

    const hasEmphasis = entryEmphasis.length > 0;

    const startMs = group[0].startMs;
    // Guarantee minimum on-screen duration
    const rawEndMs = group[group.length - 1].endMs;
    const endMs = Math.max(rawEndMs, startMs + MIN_CAPTION_DURATION_MS);

    entries.push({
      text,
      startMs,
      endMs,
      emphasisWords: entryEmphasis,
      style: hasEmphasis ? "emphasis" : "normal",
    });

    i = breakAt;
  }

  return entries;
}

/**
 * Build caption entries aligned to the rendered timeline.
 *
 * If `sceneDurationsMs` is provided (from the render path's
 * `computeSceneDurations`), captions use exactly those durations so they
 * stay synced with what's on screen. Otherwise we fall back to the audio
 * duration / estimate, which may drift from the rendered timeline if scene
 * scaling kicks in.
 */
export function buildCaptionEntries(
  scenes: ScenePlan[],
  audioResults: AudioResult[],
  maxWordsPerGroup: number,
  sceneDurationsMs?: number[]
): CaptionEntry[] {
  const allEntries: CaptionEntry[] = [];
  let offsetMs = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const audio = audioResults[i];
    const renderedDurationMs =
      sceneDurationsMs?.[i] ?? audio?.durationMs ?? estimateSceneDuration(scene);
    const speechDurationMs = audio?.durationMs ?? renderedDurationMs;

    let wordTimings: WordTiming[];
    if (audio?.wordTimings && audio.wordTimings.length > 0) {
      // Real word timings — offset, then clamp into the rendered window.
      wordTimings = audio.wordTimings.map((wt) => ({
        ...wt,
        startMs: Math.min(offsetMs + renderedDurationMs, wt.startMs + offsetMs),
        endMs: Math.min(offsetMs + renderedDurationMs, wt.endMs + offsetMs),
      }));
    } else {
      // Estimate against the speech length (so words advance at speech pace),
      // not the rendered window — captions stay in sync with the voice and
      // simply finish before the scene ends if the scene is padded.
      wordTimings = estimateWordTimings(scene.narration, speechDurationMs, offsetMs);
    }

    const entries = groupWordTimings(wordTimings, maxWordsPerGroup, scene.emphasisWords);
    allEntries.push(...entries);
    offsetMs += renderedDurationMs;
  }

  return allEntries;
}

function estimateSceneDuration(scene: ScenePlan): number {
  const words = scene.narration.split(/\s+/).length;
  return Math.max(4000, Math.min(15000, (words / 150) * 60 * 1000 + 800));
}
