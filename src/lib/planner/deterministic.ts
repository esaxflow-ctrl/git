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

// Photo-only rotation. Cards (textCard / quoteCard / evidenceCard) used to
// punctuate every other scene, but they render as full-screen typography
// which makes the output feel like a quote slideshow instead of a real
// short-form video. Captions at the bottom of the frame already carry the
// words; the picture should carry the meaning.
//
// If a scene's photo can't be fetched, the SVG fallback in
// `lib/assets/motionGraphics.ts` returns a textless atmospheric gradient
// rather than another text card.
const VISUAL_MODES: VisualMode[] = [
  "stockImage",
  "stockImage",
  "stockImage",
  "stockImage",
  "stockImage",
  "stockImage",
  "stockImage",
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

// Concrete visualizable nouns. When a scene's narration mentions one of
// these, that word is used as the Openverse search term. Stock photo APIs
// return strong matches for short concrete nouns, terrible matches for
// abstract phrases like "the cost compounds in the background", so we
// always prefer a noun the search can actually match.
const VISUALIZABLE_NOUNS = new Set([
  "phone", "screen", "laptop", "keyboard", "monitor", "computer", "tablet",
  "desk", "chair", "office", "room", "bed", "kitchen", "bathroom", "hallway",
  "window", "door", "mirror", "ceiling", "floor", "wall",
  "morning", "night", "evening", "sunrise", "sunset", "dawn", "dusk",
  "coffee", "tea", "water", "food", "dish", "dishes", "sink", "plate", "cup",
  "hand", "hands", "face", "eyes", "feet", "shoulder", "back", "head",
  "phone screen", "notification", "email", "inbox", "message", "text",
  "clock", "calendar", "watch", "timer", "alarm",
  "book", "pen", "paper", "notebook", "journal", "letter", "envelope", "page",
  "stairs", "street", "city", "park", "forest", "ocean", "mountain", "sky",
  "rain", "fog", "smoke", "fire", "snow", "wind", "shadow", "light",
  "car", "bus", "train", "subway", "road", "bridge",
  "person", "man", "woman", "child", "crowd",
  "money", "cash", "coin", "wallet", "bank",
  "running", "walking", "sitting", "standing", "sleeping", "waking",
  "laundry", "trash", "mess", "clutter", "pile", "stack",
  "mirror", "reflection", "glass", "wood", "metal", "stone",
  "candle", "lamp", "neon", "headlight", "spotlight",
]);

// Topic anchors — used when a scene has no concrete noun in its narration.
// Picks a relevant noun based on the script's overall topic so the visuals
// stay coherent across the whole video instead of jumping to random photos.
//
// Each pattern uses \b word-boundary so substrings inside other words don't
// false-match (e.g. /ai/ used to fire on "trains", routing psychology
// scripts to the tech anchor). Each list has 12+ nouns so an 11-scene
// video doesn't run out of distinct primary terms.
const TOPIC_ANCHORS: Array<{ pattern: RegExp; nouns: string[] }> = [
  {
    pattern: /\b(procrastinat\w*|avoid\w*|delay\w*|put off|low.?stake)/i,
    nouns: ["phone", "desk", "todo list", "calendar", "morning", "laundry", "unread email", "messy desk", "coffee", "alarm clock", "trash", "kitchen sink"],
  },
  {
    pattern: /\b(anxiet\w*|stress|overwhelm\w*|panic\w*|worry)/i,
    nouns: ["hands trembling", "phone", "rain window", "ceiling", "dark room", "racing thoughts", "crowded street", "deep breath", "clock", "empty bed", "tight chest", "alone night"],
  },
  {
    pattern: /\b(sleep|tired|insomnia|exhaust\w*|fatigue)/i,
    nouns: ["bed", "ceiling", "alarm clock", "pillow", "moon window", "empty bed", "dark room", "blanket", "tea cup", "dawn", "yawn", "tired eyes"],
  },
  {
    pattern: /\b(money|finance|invest\w*|saving|budget|wealth|debt)/i,
    nouns: ["coins", "wallet", "cash", "calculator", "bank", "grocery cart", "receipt", "credit card", "atm", "hundred dollar", "piggy bank", "spreadsheet"],
  },
  {
    pattern: /\b(history|ancient|war|empire|century|medieval|roman)/i,
    nouns: ["old book", "ruins", "statue", "manuscript", "vintage photo", "castle", "cobblestone", "stone arch", "marble pillar", "rusty key", "candle", "scroll"],
  },
  {
    pattern: /\b(technolog\w*|computer|software|coding|programmer)/i,
    nouns: ["laptop", "screen", "keyboard", "circuit", "data", "code", "monitor", "fiber cable", "server room", "led light", "phone", "office desk"],
  },
  {
    pattern: /\b(food|cook\w*|eat\w*|diet|meal|recipe|hungry)/i,
    nouns: ["kitchen", "knife cutting", "plate", "ingredients", "stove", "cutting board", "bread", "vegetables", "fork", "steam", "salt", "pan"],
  },
  {
    pattern: /\b(workout|gym|fit\w*|exercise|run+ing|cardio|muscle)/i,
    nouns: ["dumbbell", "running", "treadmill", "sweat", "morning run", "sneakers", "barbell", "yoga mat", "track", "stretch", "water bottle", "stairs"],
  },
  {
    pattern: /\b(relationship|love|breakup|partner|dating|romanc\w*)/i,
    nouns: ["window", "empty chair", "phone", "rain", "hallway", "two coffee cups", "candle", "couple silhouette", "sunset walk", "old letter", "mirror", "park bench"],
  },
  {
    pattern: /\b(focus|distract\w*|attention|concentrat\w*|productivit\w*)/i,
    nouns: ["phone screen", "notification", "desk", "window", "coffee", "headphones", "open book", "morning sun", "notebook", "lamp", "single candle", "quiet room"],
  },
  {
    pattern: /\b(habit|routine|pattern|discipline|consistency)/i,
    nouns: ["calendar", "morning", "coffee", "alarm clock", "sneakers", "running shoes", "journal", "open book", "sunrise", "todo list", "kitchen", "desk lamp"],
  },
  {
    pattern: /\b(psycholog\w*|mind|brain|emotion\w*|feeling)/i,
    nouns: ["mirror", "face", "thinking", "open book", "window", "alone", "silhouette", "shadow", "notebook", "head in hands", "morning light", "empty room"],
  },
];

function inferTopicNouns(script: string): string[] {
  for (const anchor of TOPIC_ANCHORS) {
    if (anchor.pattern.test(script)) return anchor.nouns;
  }
  return ["window", "morning", "hands", "desk", "phone screen", "city street", "coffee cup", "empty chair", "open book", "rain window", "dim room", "mirror"];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Word-count-aware sentence grouping for retention pacing.
//
// Targets ~targetWordsPerScene words per group. Sentences shorter than that
// are merged with their neighbour; sentences longer than 1.6× the target
// stand alone. Result is bounded by [minScenes, maxScenes].
//
// Rationale: a hard "split into N equal groups" loses the natural rhythm of
// the script. A 5-word punchline gets clumped with a 30-word setup, then
// shows on screen for 8s when it should pop in 1.5s. Word-count grouping
// keeps short beats short.
function groupSentencesByWords(
  sentences: string[],
  targetWordsPerScene: number,
  minScenes: number,
  maxScenes: number
): string[][] {
  if (sentences.length === 0) return [];
  if (sentences.length <= minScenes) return sentences.map((s) => [s]);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentWords = 0;
  const longSentenceThreshold = Math.round(targetWordsPerScene * 1.6);

  for (const sentence of sentences) {
    const w = sentence.split(/\s+/).length;
    // Long sentence stands alone (after flushing whatever's accumulated).
    if (w >= longSentenceThreshold) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
        currentWords = 0;
      }
      groups.push([sentence]);
      continue;
    }

    current.push(sentence);
    currentWords += w;

    if (currentWords >= targetWordsPerScene) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
  }
  if (current.length > 0) groups.push(current);

  // Cap to maxScenes by merging the smallest adjacent pair.
  while (groups.length > maxScenes) {
    let smallestIdx = 0;
    let smallestWords = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const pairWords = groups[i].join(" ").split(/\s+/).length + groups[i + 1].join(" ").split(/\s+/).length;
      if (pairWords < smallestWords) {
        smallestWords = pairWords;
        smallestIdx = i;
      }
    }
    groups.splice(smallestIdx, 2, [...groups[smallestIdx], ...groups[smallestIdx + 1]]);
  }

  // Pad up to minScenes by splitting the largest scene.
  while (groups.length < minScenes && groups.some((g) => g.length > 1)) {
    let biggestIdx = 0;
    let biggestWords = 0;
    for (let i = 0; i < groups.length; i++) {
      const w = groups[i].join(" ").split(/\s+/).length;
      if (w > biggestWords && groups[i].length > 1) {
        biggestWords = w;
        biggestIdx = i;
      }
    }
    const target = groups[biggestIdx];
    const half = Math.ceil(target.length / 2);
    groups.splice(biggestIdx, 1, target.slice(0, half), target.slice(half));
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

// Pull concrete visualizable nouns out of a scene's narration. These match
// stock photo searches reliably, unlike abstract phrases.
function extractConcreteNouns(narration: string): string[] {
  const lower = narration.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const found: string[] = [];
  // Two-word checks first (e.g. "phone screen", "alarm clock").
  for (const noun of VISUALIZABLE_NOUNS) {
    if (noun.includes(" ") && lower.includes(noun)) found.push(noun);
  }
  // Then single-word nouns.
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (VISUALIZABLE_NOUNS.has(word) && !found.includes(word)) found.push(word);
  }
  return found;
}

function findVisualTheme(narration: string): string[] | null {
  const words = extractKeywords(narration);
  for (const word of words) {
    if (VISUAL_THEME_MAP[word]) return VISUAL_THEME_MAP[word];
    for (const theme of Object.keys(VISUAL_THEME_MAP)) {
      if (word.includes(theme) || theme.includes(word)) {
        return VISUAL_THEME_MAP[theme];
      }
    }
  }
  return null;
}

// Search terms favour concrete nouns from the narration first, then a
// topic-anchored noun, then the theme map (kept as last resort because its
// terms are stylized and less reliable for stock photo APIs).
function buildSearchTerms(
  narration: string,
  topicNouns: string[],
  sceneIndex: number,
  scriptContext: string
): string[] {
  const concrete = extractConcreteNouns(narration);
  if (concrete.length >= 2) return concrete.slice(0, 2);
  if (concrete.length === 1) {
    return [concrete[0], topicNouns[sceneIndex % topicNouns.length]];
  }

  // No concrete noun — anchor to the topic so visuals stay coherent.
  const a = topicNouns[sceneIndex % topicNouns.length];
  const b = topicNouns[(sceneIndex + 1) % topicNouns.length];
  if (a && b && a !== b) return [a, b];

  // Last resort: theme map.
  const themeTerms = findVisualTheme(narration);
  if (themeTerms && themeTerms.length > 0) {
    return themeTerms.slice(0, 2);
  }
  return ["window light", "morning"];
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

// Visual mode is always stockImage. Each scene gets a unique photo (or a
// textless atmospheric gradient if no photo source is available), and the
// caption layer at the bottom carries the words. No card scenes — those
// were producing the "quote slideshow" feel.
function assignVisualMode(_index: number, _usedModes: VisualMode[]): VisualMode {
  return "stockImage";
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

  const allSentences = splitIntoSentences(script);
  if (allSentences.length === 0) return [];

  // Hook is always the first sentence on its own — short, fast, hard cut.
  // Retention dies if the hook scene is 8+ seconds long.
  const hookSentence = allSentences[0];
  const restSentences = allSentences.slice(1);

  // Target ~9 words per scene for snappy short-form pacing (≈ 3.5–4s at
  // 150 wpm). For a 137-word 60s script that gives 13–15 scenes. Bumping
  // this divisor pushes pacing slower; lowering it pushes pacing faster.
  const targetWordsPerScene = Math.max(
    5,
    Math.round((targetDurationSeconds * 150) / 60 / 16)
  );

  const restGroups = groupSentencesByWords(
    restSentences,
    targetWordsPerScene,
    Math.max(1, minScenes - 1),
    maxScenes - 1
  );
  const groups = [[hookSentence], ...restGroups];

  const topicNouns = inferTopicNouns(script);
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

    const searchTerms = buildSearchTerms(narration, topicNouns, i, script);

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
      pacing: isFirst
        ? "fast"
        : PACING_PATTERN[Math.min(i, PACING_PATTERN.length - 1)],
      durationHint: estimateDurationHint(narration),
      visualPurpose: purpose,
      cinematicPrompt,
    });
  }

  return scenes;
}
