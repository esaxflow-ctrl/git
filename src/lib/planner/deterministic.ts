import { v4 as uuidv4 } from "uuid";
import {
  ScenePlan,
  VisualMode,
  PacingMode,
  VisualRole,
  VisualPurpose,
  PlannerOptions,
  StyleProfile,
} from "../validation/schemas";
import { scoreSearchTerms } from "../validation/antiGeneric";

// ─── Stopwords ────────────────────────────────────────────────────────────────

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
  "whether","while","without","yet","people","think","feel","something","things",
  "really","actually","basically","literally","probably","maybe","often","always",
]);

// ─── Visual Mode & Role Sequences ─────────────────────────────────────────────

// Balanced rotation: 3 photos + 5 cards so consecutive-photo hard rule fires
// less often and visual variety is built-in rather than enforced after the fact.
const VISUAL_MODES: VisualMode[] = [
  "stockImage",
  "quoteCard",
  "stockImage",
  "gradientMotionCard",
  "evidenceCard",
  "textCard",
  "stockImage",
  "quoteCard",
];

const PACING_PATTERN: PacingMode[] = [
  "fast", "medium", "slow", "fast", "medium", "dramatic_pause", "fast", "medium",
];

const ROLE_PATTERN: VisualRole[] = [
  "hook", "evidence", "evidence", "climax", "evidence", "climax", "resolution", "transition",
];

const PURPOSE_PATTERN: VisualPurpose[] = [
  "show_emotion", "show_behavior", "show_consequence", "show_reframe",
  "show_behavior", "show_consequence", "show_action", "show_reframe",
];

// ─── Visual Theme Library ─────────────────────────────────────────────────────
// Maps emotional/topical keywords → specific cinematic search terms

const VISUAL_THEME_MAP: Record<string, string[]> = {
  // Mental patterns
  procrastination: ["cursor blinking empty document late night", "task list unchecked desk morning"],
  avoidance: ["hand reaching door handle hesitating", "person turning away window"],
  anxiety: ["hands clasped tight lap waiting room", "jaw clenched close up tension"],
  overwhelm: ["papers scattered desk hands over head", "stacked unread notifications phone screen"],
  perfectionism: ["crossed out words notebook desk", "eraser marks paper close up"],
  resistance: ["clenched fist resting desk surface", "feet stopped mid-stride floor"],
  shame: ["face turned down dim bedroom light", "person sitting floor wall behind"],
  guilt: ["unopened message phone screen dark", "person staring ceiling lying down night"],
  fear: ["hand trembling door handle close up", "shallow breathing chest tight dark room"],
  denial: ["phone face down table notifications buzzing", "eyes closed fingers plugging ears"],

  // Avoidance behaviors
  checking: ["person scrolling phone screen blue glow", "thumb swiping inbox late night"],
  ignoring: ["stack envelopes unopened kitchen table", "unread badge notification close up phone"],
  delaying: ["clock watching desk idle person", "notebook open blank page pen hovering"],
  scrolling: ["thumb scrolling phone bed dark room", "screen reflection face blank expression"],
  avoiding: ["browser tab switching procrastination desk", "half-finished task abandoned desk morning"],
  distraction: ["phone notification pull attention laptop", "eyes darting away from work"],

  // Emotions (specific visual archetypes)
  relief: ["exhale breath fogged window cold morning", "shoulders dropping tension releasing slow"],
  regret: ["person sitting empty room chair alone", "window staring rain outside"],
  loneliness: ["single lamp dark apartment night", "empty coffee cup beside untouched work"],
  frustration: ["hands pressing forehead desk face down", "keyboard pushed away frustrated"],
  clarity: ["morning sunlight window coffee steam rising", "single focused lamp dark desk"],
  numbness: ["person staring wall blank expression", "hands still lap no movement"],
  hope: ["first step forward hallway light ahead", "pen touching paper beginning"],
  determination: ["hands gripping desk edge lean forward", "direct eye contact mirror morning"],

  // Specific behaviors
  writing: ["hand pen paper close up writing", "journal open morning light writing"],
  typing: ["fingers keyboard laptop close up fast", "screen code text close up"],
  reading: ["book pages hands close up reading", "highlighted passage notebook margin notes"],
  phone: ["close up phone screen hands holding", "phone face down table decision"],
  email: ["inbox full unread messages screen", "compose email cursor blinking screen"],
  meeting: ["empty chair conference room before meeting", "muted microphone laptop screen video call"],
  planning: ["sticky notes wall planning session", "calendar pen marking dates desk"],
  decision: ["two paths fork crossroads overhead view", "hand hovering two options desk"],

  // Time of day / settings
  "late night": ["dark room blue screen glow 3am", "empty street lamp lit night quiet"],
  morning: ["alarm phone bedside snooze morning", "sunlight strips window floor slow morning"],
  office: ["empty office chair desk end of day", "monitor screen reflection late worker"],
  bedroom: ["unmade bed morning sunlight stripe", "bedside table items close up morning"],
  kitchen: ["cold coffee cup forgotten counter", "sink dishes pile avoidance morning"],

  // Psychological concepts
  momentum: ["person walking purposeful stride sidewalk", "pen writing fast filled page"],
  clarity2: ["fog lifting morning landscape aerial", "single beam light dark room focus"],
  pattern: ["same route repeated footsteps close up", "identical days calendar close up"],
  progress: ["stairs ascending view from below", "hands peeling off sticky note done"],
  identity: ["mirror close up reflection thinking", "person pausing doorway decision moment"],
  habit: ["same mug same desk same morning light", "ritual repeated hands coffee routine"],
  change: ["before after split room light dark", "single different step marked floor"],
  awareness: ["eyes opening recognition moment close up", "pulling back reveal wider perspective"],
  control: ["organized desk single task focus", "one step at a time staircase"],
  freedom: ["door opening morning light flood in", "shoulders back deep breath outside"],

  // Data / evidence concepts
  research: ["open book annotated margins close up", "data points graph paper hand drawn"],
  statistics: ["numbers handwritten notebook evidence", "percentage marker whiteboard close up"],
  study: ["academic paper highlighted desk lamp", "scientific citation text close up"],
  evidence: ["printed document marked highlighter desk", "receipts organized evidence pile"],
  pattern2: ["repeated behavior tracked calendar", "timeline events mapped wall"],

  // Physical sensations
  tension: ["neck muscles tight side profile", "shoulders hunched desk posture close up"],
  exhaustion: ["eyes heavy person screen night", "face resting arms desk tired"],
  weight: ["heavy steps floor close up slow", "bags under eyes mirror morning"],
  release: ["unclenching fist open palm", "long exhale visible cold air"],
};

// Shot types by visual mode and scene purpose
const SHOT_TYPE_BY_PURPOSE: Record<VisualPurpose, string[]> = {
  show_behavior: ["close up", "over shoulder", "medium shot"],
  show_emotion: ["extreme close up face", "close up hands", "tight medium"],
  show_consequence: ["wide establishing", "medium wide", "overhead"],
  show_reframe: ["pull back reveal", "wide context", "aerial perspective"],
  show_action: ["medium action", "close up hands task", "tracking follow"],
};

const CINEMATIC_CONTEXTS_BY_MODE: Record<VisualMode, string> = {
  stockVideo: "cinema vérité style, natural light, candid",
  stockImage: "editorial photography, strong composition, moody lighting",
  gradientMotionCard: "abstract atmospheric, color-driven emotional tone",
  textCard: "typographic impact, minimal, high contrast",
  quoteCard: "intimate confessional, inner voice, relatable",
  evidenceCard: "documentary factual, data visualization, credible",
  mapCard: "scale and scope, systemic view, information design",
  timelineCard: "temporal progression, before and after, narrative arc",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function findVisualTheme(narration: string): string[] | null {
  const words = extractKeywords(narration);
  // Direct theme match
  for (const word of words) {
    if (VISUAL_THEME_MAP[word]) return VISUAL_THEME_MAP[word];
    // Partial match — theme keyword is a substring of a word
    for (const theme of Object.keys(VISUAL_THEME_MAP)) {
      if (word.includes(theme) || theme.includes(word)) {
        return VISUAL_THEME_MAP[theme];
      }
    }
  }
  return null;
}

// Mood → deterministic fallback terms used when keyword-built terms score too low
const MOOD_FALLBACK_TERMS: Record<string, string[]> = {
  hollow: ["person staring wall blank expression", "empty cup desk forgotten morning"],
  dread: ["hands clasped tight waiting room dim", "shallow breathing chest close up"],
  restless: ["fingers tapping table close up", "feet pacing floor restless"],
  relief: ["exhale breath fogged window cold", "shoulders dropping tension slow"],
  triumphant: ["hands raised open sky dawn", "finish line stride forward"],
  mysterious: ["fog corridor dark hallway lit", "shadow figure silhouette window"],
  analytical: ["notebook pen annotated margins lamp", "data points graph paper hand"],
  historical: ["aged paper close up texture", "old photograph framed desk"],
  neutral: ["person window quiet room light", "single lamp desk late evening"],
  defiant: ["direct gaze lens close up", "clenched jaw side profile rim light"],
};

function buildCinematicSearchTerms(
  narration: string,
  purpose: VisualPurpose,
  mode: VisualMode,
  scriptContext: string,
  sceneIndex = 0,
  mood = "neutral",
): string[] {
  const shotTypes = SHOT_TYPE_BY_PURPOSE[purpose];
  // Deterministic shot selection keyed on index — no Math.random
  const shotPrefix = shotTypes[sceneIndex % shotTypes.length];
  const context = CINEMATIC_CONTEXTS_BY_MODE[mode];

  const themeTerms = findVisualTheme(narration);
  const keywords = extractKeywords(narration).slice(0, 3);

  let candidates: string[];

  if (themeTerms && themeTerms.length > 0) {
    candidates = themeTerms.slice(0, 2);
  } else if (keywords.length === 0) {
    candidates = MOOD_FALLBACK_TERMS[mood] ?? MOOD_FALLBACK_TERMS["neutral"]!;
  } else {
    const primary =
      `${shotPrefix} ${keywords[0]} ${keywords[1] ?? ""} ${context.split(",")[0]}`.trim();
    const secondary = keywords[1]
      ? `${keywords[1]} ${keywords[2] ?? keywords[0]} close up detail`
      : `${keywords[0]} detail close up light`;
    candidates = [primary, secondary].map((t) => t.replace(/\s+/g, " ").trim());
  }

  // Score the candidates; if average is too low, fall back to mood-keyed specifics
  const { avgScore, weak } = scoreSearchTerms(candidates);
  if (avgScore < 3 || weak.length === candidates.length) {
    const moodTerms = MOOD_FALLBACK_TERMS[mood] ?? MOOD_FALLBACK_TERMS["neutral"]!;
    // Mix: replace weakest slot with mood fallback, keep strongest original
    const strong = candidates.filter((_, i) => !weak.includes(candidates[i]));
    candidates = [
      ...(strong.length > 0 ? strong : []),
      moodTerms[sceneIndex % moodTerms.length],
    ];
  }

  return candidates.slice(0, 3);
}

function buildCinematicPrompt(
  narration: string,
  purpose: VisualPurpose,
  mode: VisualMode,
  mood: string
): string {
  const shotTypes = SHOT_TYPE_BY_PURPOSE[purpose];
  const shot = shotTypes[0];
  const keywords = extractKeywords(narration).slice(0, 3).join(" ");
  const moodDescriptors: Record<string, string> = {
    tense: "harsh shadows, cool blue tones, tight framing",
    triumphant: "warm golden light, expansive framing, upward angle",
    mysterious: "low key lighting, fog or haze, slow movement",
    analytical: "clean flat lighting, neutral tones, organized frame",
    historical: "sepia-adjacent warmth, aged texture, wide establishing",
    neutral: "soft diffused light, medium tones, balanced composition",
    dread: "underexposed shadows, claustrophobic framing, stillness",
    relief: "warm soft backlight, open space, slow exhale implied",
    hollow: "overcast flat light, empty spaces, muted palette",
    restless: "shallow focus, slight motion blur, agitated framing",
    defiant: "low angle, strong rim light, direct gaze",
  };
  const moodDesc = moodDescriptors[mood] ?? "natural light, honest framing, emotionally grounded";

  return `${shot} of subject related to ${keywords || narration.split(" ").slice(0, 4).join(" ")}, ${moodDesc}, 9:16 composition, no text in frame, no watermark, no distorted faces`;
}

function extractEmphasisWords(text: string): string[] {
  const matches: string[] = [];
  const capsMatches = text.match(/\b[A-Z]{2,}\b/g) ?? [];
  matches.push(...capsMatches.map((w) => w.toLowerCase()));
  const emphasisMatches = text.match(/\b\w+(?=[!?])/g) ?? [];
  matches.push(...emphasisMatches.map((w) => w.toLowerCase()));
  return [...new Set(matches)].slice(0, 4);
}

function estimateDurationHint(narration: string): number {
  const wordCount = narration.split(/\s+/).length;
  return Math.max(4, Math.min(15, Math.round((wordCount / 150) * 60)));
}

function buildCaption(narration: string): string {
  const sentences = splitIntoSentences(narration);
  const first = sentences[0] ?? narration;
  const words = first.split(/\s+/).slice(0, 8);
  let caption = words.join(" ");
  if (!caption.endsWith(".") && !caption.endsWith("!") && !caption.endsWith("?")) {
    caption += ".";
  }
  return caption;
}

const PHOTO_MODES = new Set<VisualMode>(["stockImage", "stockVideo"]);
const CARD_MODES: VisualMode[] = ["quoteCard", "evidenceCard", "textCard", "timelineCard", "gradientMotionCard"];

function assignVisualMode(
  index: number,
  usedModes: VisualMode[],
  rolePattern: VisualRole[],
  style?: StyleProfile,
): VisualMode {
  const last = usedModes[usedModes.length - 1];
  const secondLast = usedModes[usedModes.length - 2];
  const thirdLast = usedModes[usedModes.length - 3];

  const preferred = style?.visualMixRules?.preferredModes ?? [];

  // Hard rule: no more than 2 consecutive photo scenes
  const twoConsecutivePhotos =
    last != null && secondLast != null && PHOTO_MODES.has(last) && PHOTO_MODES.has(secondLast);

  // Soft rule: if 2 of last 3 were photos, prefer a card next
  const twoOfThreePhotos =
    ([last, secondLast, thirdLast].filter(Boolean) as VisualMode[]).filter((m) =>
      PHOTO_MODES.has(m)
    ).length >= 2;

  // Role balance: hook was a photo → first climax gets a card, and vice versa
  const currentRole = rolePattern[Math.min(index, rolePattern.length - 1)];
  const hookMode = usedModes[0];
  const firstClimax = !rolePattern.slice(0, index).includes("climax");
  const forceCardForClimaxBalance =
    currentRole === "climax" && firstClimax && hookMode != null && PHOTO_MODES.has(hookMode);

  const forceCard = twoConsecutivePhotos || twoOfThreePhotos || forceCardForClimaxBalance;

  if (forceCard) {
    const cardPool = CARD_MODES.filter((m) => m !== last && m !== secondLast);
    // Bias toward style-preferred cards if any match
    const styleCards = cardPool.filter((m) => preferred.includes(m));
    const pool = styleCards.length > 0 ? styleCards : cardPool;
    return pool.length > 0 ? pool[index % pool.length] : CARD_MODES[index % CARD_MODES.length];
  }

  const candidates = VISUAL_MODES.filter((m) => m !== last && m !== secondLast);
  const basePool = candidates.length > 0 ? candidates : VISUAL_MODES.filter((m) => m !== last);

  // Bias toward style-preferred modes when possible
  const stylePool = basePool.filter((m) => preferred.includes(m));
  const finalPool = stylePool.length > 0 ? stylePool : basePool;
  return finalPool[index % finalPool.length];
}

function inferMood(text: string): string {
  const lower = text.toLowerCase();
  if (lower.match(/avoid|ignore|procrastinat|put off|later|delay/)) return "hollow";
  if (lower.match(/anxious|anxiety|overwhelm|dread|fear/)) return "dread";
  if (lower.match(/tired|exhaust|drain|heavy|weight/)) return "restless";
  if (lower.match(/relief|release|breath|finally|done/)) return "relief";
  if (lower.match(/shame|embarrass|guilt|regret|fault/)) return "hollow";
  if (lower.match(/anger|frustrat|rage|furious/)) return "defiant";
  if (lower.match(/success|win|achieve|accomplish|proud/)) return "triumphant";
  if (lower.match(/wonder|discover|reveal|secret|hidden/)) return "mysterious";
  if (lower.match(/data|evidence|research|study|found/)) return "analytical";
  if (lower.match(/history|ancient|century|origin/)) return "historical";
  if (lower.match(/start|begin|action|step|move|change/)) return "defiant";
  return "neutral";
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function generateDeterministic(
  script: string,
  options: PlannerOptions
): Promise<ScenePlan[]> {
  const { minScenes, maxScenes, targetDurationSeconds } = options;

  const sentences = splitIntoSentences(script);
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
    const isFirst = i === 0;
    const isLast = i === groups.length - 1;

    const purpose: VisualPurpose = isFirst
      ? "show_emotion"
      : isLast
      ? "show_action"
      : PURPOSE_PATTERN[Math.min(i, PURPOSE_PATTERN.length - 1)];

    const visualMode = assignVisualMode(i, usedModes, ROLE_PATTERN, options.style);
    usedModes.push(visualMode);

    const mood = inferMood(narration);
    const searchTerms = buildCinematicSearchTerms(narration, purpose, visualMode, script, i, mood);

    const cinematicPrompt = buildCinematicPrompt(narration, purpose, visualMode, mood);

    scenes.push({
      id: uuidv4(),
      narration,
      caption: buildCaption(narration),
      searchTerms: searchTerms.slice(0, 3),
      visualMode,
      emphasisWords: extractEmphasisWords(narration),
      mood,
      sceneGoal: isFirst
        ? "hook the viewer with visceral emotional recognition"
        : isLast
        ? "give the viewer a clear action to take"
        : "deepen the emotional or conceptual understanding",
      visualRole: ROLE_PATTERN[Math.min(i, ROLE_PATTERN.length - 1)],
      pacing: PACING_PATTERN[Math.min(i, PACING_PATTERN.length - 1)],
      durationHint: estimateDurationHint(narration),
      visualPurpose: purpose,
      cinematicPrompt,
    });
  }

  return scenes;
}
