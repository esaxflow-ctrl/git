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

export function groupWordTimings(
  wordTimings: WordTiming[],
  maxWordsPerGroup: number,
  emphasisWords: string[]
): CaptionEntry[] {
  if (wordTimings.length === 0) return [];

  const emphasisSet = new Set(emphasisWords.map((w) => w.toLowerCase()));
  const entries: CaptionEntry[] = [];
  let i = 0;

  while (i < wordTimings.length) {
    const group: WordTiming[] = [];
    let breakAt = i;

    // Collect up to maxWordsPerGroup words, breaking at natural punctuation
    while (group.length < maxWordsPerGroup && breakAt < wordTimings.length) {
      group.push(wordTimings[breakAt]);
      breakAt++;

      // Natural break points
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

    entries.push({
      text,
      startMs: group[0].startMs,
      endMs: group[group.length - 1].endMs,
      emphasisWords: entryEmphasis,
      style: hasEmphasis ? "emphasis" : "normal",
    });

    i = breakAt;
  }

  return entries;
}

export function buildCaptionEntries(
  scenes: ScenePlan[],
  audioResults: AudioResult[],
  maxWordsPerGroup: number
): CaptionEntry[] {
  const allEntries: CaptionEntry[] = [];
  let offsetMs = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const audio = audioResults[i];
    const sceneDurationMs = audio?.durationMs ?? estimateSceneDuration(scene);

    let wordTimings: WordTiming[];
    if (audio?.wordTimings && audio.wordTimings.length > 0) {
      // Offset existing timings
      wordTimings = audio.wordTimings.map((wt) => ({
        ...wt,
        startMs: wt.startMs + offsetMs,
        endMs: wt.endMs + offsetMs,
      }));
    } else {
      wordTimings = estimateWordTimings(scene.narration, sceneDurationMs, offsetMs);
    }

    const entries = groupWordTimings(wordTimings, maxWordsPerGroup, scene.emphasisWords);
    allEntries.push(...entries);
    offsetMs += sceneDurationMs;
  }

  return allEntries;
}

function estimateSceneDuration(scene: ScenePlan): number {
  const words = scene.narration.split(/\s+/).length;
  return Math.max(4000, Math.min(15000, (words / 150) * 60 * 1000 + 800));
}
