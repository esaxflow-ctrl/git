import { v4 as uuidv4 } from "uuid";
import {
  ScenePlan,
  VisualMode,
  PacingMode,
  VisualRole,
  VisualPurpose,
  PlannerOptions,
} from "../validation/schemas";

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

// Photo-first rotation: real photos for the majority, SVG cards as
// rhythmic punctuation. Each photo is unique (Openverse search per scene)
// so this still avoids the "everything looks the same" failure mode.
const VISUAL_MODES: VisualMode[] = [
  "stockImage",
  "quoteCard",
  "stockImage",
  "stockImage",
  "evidenceCard",
  "stockImage",
  "textCard",
  "stockImage",
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

function buildCinematicSearchTerms(
  narration: string,
  purpose: VisualPurpose,
  mode: VisualMode,
  scriptContext: string
): string[] {
  const themeTerms = findVisualTheme(narration);
  if (themeTerms && themeTerms.length > 0) {
    // Use up to 2 theme terms for specificity
    return themeTerms.slice(0, 2);
  }

  // Fallback: build from keywords + shot type context
  const keywords = extractKeywords(narration).slice(0, 3);
  const shotTypes = SHOT_TYPE_BY_PURPOSE[purpose];
  const shotPrefix = shotTypes[Math.floor(Math.random() * shotTypes.length)];
  const context = CINEMATIC_CONTEXTS_BY_MODE[mode];

  if (keywords.length === 0) {
    return ["person quiet room contemplative", "single object desk close up"];
  }

  // Combine keyword with shot descriptor for specificity
  const primary = `${shotPrefix} ${keywords[0]} ${keywords[1] ?? ""} ${context.split(",")[0]}`.trim();
  const secondary = keywords[1]
    ? `${keywords[1]} ${keywords[2] ?? keywords[0]} close up detail`
    : `${keywords[0]} detail close up light`;

  return [primary, secondary].map((t) => t.replace(/\s+/g, " ").trim());
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

function assignVisualMode(index: number, usedModes: VisualMode[]): VisualMode {
  const last = usedModes[usedModes.length - 1];
  const secondLast = usedModes[usedModes.length - 2];
  // Never repeat last 2 modes consecutively if possible
  const candidates = VISUAL_MODES.filter((m) => m !== last && m !== secondLast);
  const pool = candidates.length > 0 ? candidates : VISUAL_MODES.filter((m) => m !== last);
  return pool[index % pool.length];
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

    const visualMode = assignVisualMode(i, usedModes);
    usedModes.push(visualMode);

    const mood = inferMood(narration);

    const searchTerms = buildCinematicSearchTerms(narration, purpose, visualMode, script);

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
