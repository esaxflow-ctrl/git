// Script validator — enforces 60-second short-form constraints.
//
// Targets a 58–62s spoken voiceover at ~150 wpm:
//   135–165 words is the safe range.
// Hook (first sentence) must read in ≤ 2.5s — i.e. ≤ 6 words at 150 wpm.

export interface ScriptStructure {
  hook: string;
  setup: string;
  body: string[];
  payoff: string;
  cta: string;
}

export interface ScriptValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ScriptValidationResult {
  valid: boolean;
  wordCount: number;
  estimatedSeconds: number;
  hookWordCount: number;
  hookSeconds: number;
  issues: ScriptValidationIssue[];
}

const WORDS_PER_SECOND = 150 / 60; // 2.5

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
  /^are\s+you\s+ready/i,
  /^imagine\s+(?:if|this)/i,
];

const REPETITIVE_AI_PHRASES: RegExp[] = [
  /\bgame[-\s]changer\b/gi,
  /\bunlock(?:s|ing|ed)?\s+(?:the\s+)?secret/gi,
  /\bharness(?:ing|es|ed)?\s+(?:the\s+)?power/gi,
  /\bin\s+today'?s\s+fast[-\s]paced\s+world\b/gi,
  /\bat\s+the\s+end\s+of\s+the\s+day\b/gi,
  /\blevel\s+up\s+your\s+life\b/gi,
  /\bbut\s+wait,?\s+there'?s\s+more\b/gi,
  /\bnext\s+level\b/gi,
];

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function estimateSeconds(text: string): number {
  return Math.round((countWords(text) / WORDS_PER_SECOND) * 10) / 10;
}

export function detectStructure(script: string): ScriptStructure {
  const sentences = script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return { hook: "", setup: "", body: [], payoff: "", cta: "" };
  }

  const hook = sentences[0] ?? "";
  const last = sentences[sentences.length - 1] ?? "";
  const secondLast = sentences[sentences.length - 2] ?? "";

  // CTA heuristic — last sentence with imperative or "follow/save/share/watch" verbs
  const ctaPattern = /\b(follow|save|share|watch|try|do|stop|start|tap|comment|like|click)\b/i;
  let cta = "";
  let payoff = secondLast;
  if (ctaPattern.test(last)) {
    cta = last;
    payoff = secondLast || "";
  } else {
    payoff = last;
    cta = "";
  }

  const middle = sentences.slice(1, sentences.length - (cta ? 2 : 1));
  const setup = middle[0] ?? "";
  const body = middle.slice(1);

  return { hook, setup, body, payoff, cta };
}

export function validateScript(script: string): ScriptValidationResult {
  const issues: ScriptValidationIssue[] = [];
  const trimmed = script.trim();
  const wordCount = countWords(trimmed);
  const estimatedSecondsValue = estimateSeconds(trimmed);

  const structure = detectStructure(trimmed);
  const hookWordCount = countWords(structure.hook);
  const hookSeconds = estimateSeconds(structure.hook);

  // ── Length gate (135–165 words for 58–62s at 150 wpm) ─────────────────
  if (wordCount < 120) {
    issues.push({
      level: "error",
      code: "too_short",
      message: `Script is ${wordCount} words (~${estimatedSecondsValue}s). Need 135–165 words for a 60s voiceover.`,
    });
  } else if (wordCount < 135) {
    issues.push({
      level: "warning",
      code: "short",
      message: `Script is ${wordCount} words (~${estimatedSecondsValue}s). 135–165 words is the safe band.`,
    });
  } else if (wordCount > 175) {
    issues.push({
      level: "error",
      code: "too_long",
      message: `Script is ${wordCount} words (~${estimatedSecondsValue}s). Trim to 135–165 to fit 60s.`,
    });
  } else if (wordCount > 165) {
    issues.push({
      level: "warning",
      code: "long",
      message: `Script is ${wordCount} words (~${estimatedSecondsValue}s). Risk of overrunning 62s.`,
    });
  }

  // ── Hook gate (≤ 2.5s ≈ ≤ 6 words) ─────────────────────────────────────
  if (hookWordCount === 0) {
    issues.push({
      level: "error",
      code: "missing_hook",
      message: "First sentence (hook) is missing.",
    });
  } else if (hookSeconds > 3.0) {
    issues.push({
      level: "error",
      code: "hook_too_long",
      message: `Hook is ${hookWordCount} words (~${hookSeconds}s). Cut to 6 words or fewer (≤2.5s).`,
    });
  } else if (hookSeconds > 2.5) {
    issues.push({
      level: "warning",
      code: "hook_long",
      message: `Hook reads in ~${hookSeconds}s. Aim for ≤2.5s for retention.`,
    });
  }

  // ── Generic-opener blocklist ───────────────────────────────────────────
  for (const pattern of GENERIC_OPENERS) {
    if (pattern.test(structure.hook)) {
      issues.push({
        level: "error",
        code: "generic_opener",
        message: `Hook starts with a banned generic phrase ("${structure.hook.slice(0, 40)}…"). Rewrite.`,
      });
      break;
    }
  }

  // ── Repetitive AI filler ───────────────────────────────────────────────
  for (const pattern of REPETITIVE_AI_PHRASES) {
    const matches = trimmed.match(pattern);
    if (matches) {
      issues.push({
        level: "warning",
        code: "ai_filler",
        message: `Contains AI-filler phrase: "${matches[0]}". Rewrite for authenticity.`,
      });
    }
  }

  // ── Long sentences (spoken short-form prefers ≤ 18 words / sentence) ──
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const longSentences = sentences.filter((s) => countWords(s) > 22);
  if (longSentences.length > 0) {
    issues.push({
      level: "warning",
      code: "long_sentence",
      message: `${longSentences.length} sentence(s) over 22 words. Break up for spoken pacing.`,
    });
  }

  // ── Repeated phrase detection (simple n-gram check) ───────────────────
  const repeatedPhrase = findRepeatedPhrase(trimmed);
  if (repeatedPhrase) {
    issues.push({
      level: "warning",
      code: "repetition",
      message: `Phrase "${repeatedPhrase}" appears more than once. Vary the language.`,
    });
  }

  // ── Section completeness ──────────────────────────────────────────────
  if (sentences.length < 4) {
    issues.push({
      level: "error",
      code: "missing_sections",
      message: `Only ${sentences.length} sentence(s). Need hook + setup + 3 points + payoff (≥6 sentences).`,
    });
  }

  const valid = !issues.some((i) => i.level === "error");
  return {
    valid,
    wordCount,
    estimatedSeconds: estimatedSecondsValue,
    hookWordCount,
    hookSeconds,
    issues,
  };
}

function findRepeatedPhrase(text: string): string | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 8) return null;

  const seen = new Map<string, number>();
  for (let i = 0; i < words.length - 3; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (trigram.split(" ").every((w) => w.length <= 3)) continue; // ignore stopword grams
    seen.set(trigram, (seen.get(trigram) ?? 0) + 1);
  }
  for (const [phrase, count] of seen) {
    if (count >= 2) return phrase;
  }
  return null;
}
