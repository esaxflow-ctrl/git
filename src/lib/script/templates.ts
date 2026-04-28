// Curated 60-second short-form script templates.
//
// Each template ships with per-beat visual hints — a 1–2 word Pexels search
// term tied to each spoken sentence. The planner uses these hints directly
// when the user hasn't edited the script, so each scene's photo actually
// depicts what the line is saying instead of a random topic-anchor noun.

export interface ScriptTemplate {
  id: string;
  name: string;
  tone: string;
  description: string;
  matchPatterns: RegExp[];
  hook: string;
  hookVisual: string;
  setup: string;
  setupVisual: string;
  body: string[];
  bodyVisuals: string[]; // Same length as body. Each is a Pexels search term.
  payoff: string;
  payoffVisual: string;
  cta: string;
  ctaVisual: string;
  alternateHooks: string[];
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "pattern_recognition",
    name: "Pattern Recognition",
    tone: "sharp, observational, psychology-coded",
    description:
      "Names a familiar uncomfortable feeling, reveals what it actually signals, gives a way out.",
    matchPatterns: [
      /\b(procrastinat\w*|avoid\w*|delay\w*|put\s*off|low.?stake)/i,
      /\b(habit|pattern|routine|discipline)/i,
      /\b(anxiety|stress|overwhelm|panic|worry)/i,
    ],
    hook: "{topicShort} is a signal.",
    hookVisual: "person staring blank wall",
    setup:
      "Most people read it wrong. They think it means they are broken or weak. They think the answer is somewhere in more discipline, more willpower, more pushing.",
    setupVisual: "person head hands defeat",
    body: [
      "It is none of that. The feeling is your brain flagging a mismatch.",
      "Between what you said you wanted, and what your body actually feels safe doing right now.",
      "The discipline frame keeps you stuck because it treats the symptom and ignores the entire message underneath.",
      "Every time you push past it without listening, you train your own nervous system to stop trusting its own warnings.",
      "After enough reps the warnings get louder, not quieter. The body knows it is not being heard.",
      "The discomfort is not the enemy. It is the interface. It is the only honest data you get.",
    ],
    bodyVisuals: [
      "brain scan abstract",
      "person mirror reflection",
      "iceberg hidden underwater",
      "person punching bag exhausted",
      "alarm bell ringing",
      "open journal notebook",
    ],
    payoff:
      "Next time you feel it, do not push through. Pause for ten seconds. Ask which specific part of this you are actually scared of. Whatever shows up first is the answer worth working with.",
    payoffVisual: "deep breath exhale window",
    cta: "Try it once today. You will be surprised how loud the real reason was.",
    ctaVisual: "morning sunrise window",
    alternateHooks: [
      "You are not lazy.",
      "{topicShort} means something else.",
      "Stop pushing through this.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "hidden_cost",
    name: "Hidden Cost",
    tone: "investigative, confronting, finance/health-coded",
    description:
      "Names something that looks free or harmless, surfaces the real compounding cost, then offers an exit.",
    matchPatterns: [
      /\b(money|finance|invest\w*|budget|debt|cheap|free|fees?|rich)/i,
      /\b(diet|food|sugar|alcohol|smok\w*|fitness|sleep)/i,
      /\b(scroll\w*|phone|social\s*media|tiktok|instagram)/i,
    ],
    hook: "{topicShort} is not free.",
    hookVisual: "free sample shop sign",
    setup:
      "It looks free in the moment, and that is exactly the trick. The price gets charged later, in a currency you don't notice you are spending.",
    setupVisual: "credit card receipt close",
    body: [
      "Every time you do it, you withdraw a small amount from a different account.",
      "Your attention. Your energy. Your future flexibility. Your sleep tomorrow night.",
      "Each withdrawal feels too small to matter, and none of them is big enough to flag in the moment.",
      "But they compound the way credit card interest compounds, and you don't see the balance until much later.",
      "Six months in, you are paying interest on choices you do not even remember making.",
      "By the time the bill is obvious, the balance is already gone, and the part of you that could have caught it has stopped trying.",
    ],
    bodyVisuals: [
      "atm withdrawal screen",
      "tired person bed insomnia",
      "single coin drop jar",
      "rising stock chart graph",
      "calendar pages flipping",
      "empty wallet table",
    ],
    payoff:
      "The fix is not willpower. It is making the cost visible at the moment of the decision instead of a year later, when no amount of discipline can refund what you already spent.",
    payoffVisual: "spreadsheet budget tracker",
    cta: "Track it for one week. The number alone will change the behavior more than any rule could.",
    ctaVisual: "notebook pen tracking",
    alternateHooks: [
      "Look at the real bill.",
      "Free is the trick.",
      "{topicShort} costs more than you think.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "contrarian_truth",
    name: "Contrarian Truth",
    tone: "blunt, contrarian, myth-busting",
    description:
      "States the common belief, declares it wrong, gives the harder real answer.",
    matchPatterns: [
      /\b(motivation|inspiration|hustle|grind|bullshit)/i,
      /\b(advice|tips|hack|secret|trick)/i,
      /\b(productivity|success|wealth|happiness)/i,
    ],
    hook: "Everyone is wrong about this.",
    hookVisual: "crowd people street",
    setup:
      "The popular advice on {topicShort} sounds clean and confident. It also doesn't work. If it worked, you would not need to keep hearing it every six months from a new face.",
    setupVisual: "podium speaker microphone",
    body: [
      "The real answer is harder, slower, and a lot less satisfying to share.",
      "It is not a tip, a hack, or a five-step framework you can save and never look at again.",
      "It's a quiet shift in what you treat as normal, day after day, when nobody is watching.",
      "You stop chasing the version of yourself that performs the change for an audience.",
      "You become the version that actually lives it without telling anyone.",
      "That second version is quieter. You don't get applause for it. That is the cost of it being real.",
    ],
    bodyVisuals: [
      "uphill climb stairs",
      "torn checklist crumpled",
      "candle dim room solitary",
      "spotlight performer stage",
      "lone walker forest path",
      "empty theater seats",
    ],
    payoff:
      "If your strategy needs you to feel inspired to keep going, it is not actually a strategy. It is a feeling you are renting, and the rent goes up every month.",
    payoffVisual: "rented apartment empty",
    cta: "Pick the slow boring version of the work. It is the one that compounds.",
    ctaVisual: "person writing patience desk",
    alternateHooks: [
      "The advice is wrong.",
      "Stop chasing motivation.",
      "{topicShort} is rented confidence.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "tiny_action",
    name: "Tiny Action",
    tone: "calm, practical, productivity-coded",
    description:
      "Tells the viewer to stop trying the big thing, gives a 30-second alternative, explains why it works.",
    matchPatterns: [
      /\b(start|begin|trying|stuck|stagnant|new\s+routine)/i,
      /\b(workout|gym|run\w*|exercise|fitness)/i,
      /\b(write|writing|journal|book|create)/i,
    ],
    hook: "Stop trying to {topicShort}.",
    hookVisual: "frustrated person desk",
    setup:
      "The big version is what is killing you. It needs a clear hour, the right mood, and zero distractions. You are not getting any of those today, and you know it.",
    setupVisual: "cluttered messy desk",
    body: [
      "Make it smaller. Embarrassingly smaller, on purpose.",
      "Two pushups. One sentence. Three minutes. Whatever sounds laughable when you say it out loud.",
      "The point is not the work you do at that scale. The point is who you become by showing up at all.",
      "Identity is built through repetition, not intensity. One real rep beats zero perfect reps by infinity.",
      "After the tiny version, you will often keep going past it. That is a bonus, not a requirement.",
      "You are not allowed to count on the bonus. The deal is the tiny version, every single day, no exceptions.",
    ],
    bodyVisuals: [
      "small seedling sprout",
      "single pushup floor",
      "footprint sand single",
      "stairs single step",
      "marathon finish line",
      "calendar daily checkmark",
    ],
    payoff:
      "It is not because two pushups are enough. It is because two pushups are impossible to skip without lying to yourself, and the daily refusal to lie is what actually changes you.",
    payoffVisual: "honest mirror reflection",
    cta: "Pick the smallest version right now. Do it before you finish reading this.",
    ctaVisual: "running shoes door ready",
    alternateHooks: [
      "Two pushups counts.",
      "The big version is a trap.",
      "Make it embarrassingly small.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "system_vs_symptom",
    name: "System vs Symptom",
    tone: "diagnostic, calm, reframe-driven",
    description:
      "Tells viewer the thing they're trying to fix is the symptom, names the actual system, points at the real lever.",
    matchPatterns: [
      /\b(focus|distract\w*|attention|concentrat\w*)/i,
      /\b(self.?improvement|self.?help|growth|change)/i,
      /\b(relationship|love|partner|dating)/i,
    ],
    hook: "{topicShort} isn't the problem.",
    hookVisual: "doctor stethoscope examining",
    setup:
      "You keep treating it like the problem because that is the part you can see. The thing you can name. The thing that actually hurts when you sit with it.",
    setupVisual: "person hands face overwhelmed",
    body: [
      "But it is downstream. It is the smoke, not the fire.",
      "The real system is two layers behind it, and you have stopped looking because the smoke is already loud enough to occupy you.",
      "Most of what people call self-improvement is rearranging smoke. It feels like progress. It is not.",
      "If you fix the upstream system, the symptom resolves on its own, quietly, and you barely notice.",
      "If you keep fighting the symptom, you will be doing it forever, and the system stays untouched the entire time.",
      "Years pass. The symptom changes shape. The shape underneath does not.",
    ],
    bodyVisuals: [
      "smoke rising fire",
      "iceberg underwater hidden",
      "person rearranging furniture",
      "calm river flowing",
      "person fighting shadow",
      "old photograph faded",
    ],
    payoff:
      "Ask one question. Not 'how do I stop {topicShort}?' but 'what is {topicShort} a response to?' The answer will not be quick or comfortable. That is how you know it is the right one.",
    payoffVisual: "question mark glowing",
    cta: "Sit with that question for ten minutes. Don't write. Just listen.",
    ctaVisual: "person meditating quiet",
    alternateHooks: [
      "You're fixing the wrong thing.",
      "The smoke isn't the fire.",
      "{topicShort} is downstream.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "time_trap",
    name: "Time Trap",
    tone: "urgent, slightly heavy, existential-coded",
    description:
      "Names a small repeated behavior, makes the long-term cost vivid, gives one concrete escape.",
    matchPatterns: [
      /\b(time|years|life|wast\w*|aging|old)/i,
      /\b(scroll\w*|feed|content|consum\w*)/i,
      /\b(comfort|easy|safe|same|stuck)/i,
    ],
    hook: "{topicShort} steals years.",
    hookVisual: "clock ticking close up",
    setup:
      "It feels like minutes when you are doing it. The minutes do not feel important. That is exactly why they add up faster than anything else in your life.",
    setupVisual: "phone scrolling thumb close",
    body: [
      "Twenty minutes a day, every single day, is one full week per year.",
      "Five years from now, that is more than one entire month of your life.",
      "Given to something you do not even remember actively choosing.",
      "Most people never run that math because the math is uncomfortable, and we are good at avoiding uncomfortable math.",
      "The fix is not deleting an app or buying a focus journal. It is replacing the moment.",
      "You do not have a willpower problem. You have a default problem. Whatever you reach for first wins, and you almost never decide what that is.",
    ],
    bodyVisuals: [
      "calendar weekly grid",
      "candle burning down",
      "blurred memory photograph",
      "calculator paper math",
      "phone face down table",
      "morning hand reaching alarm",
    ],
    payoff:
      "Decide tonight what you reach for tomorrow morning, before you are conscious enough to argue with yourself. That single choice quietly owns the next decade of your life.",
    payoffVisual: "book bedside table",
    cta: "Pick the new default. Put it where the old one used to live.",
    ctaVisual: "morning routine sunrise",
    alternateHooks: [
      "Run the actual math.",
      "Minutes become months.",
      "The default is the choice.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "identity_shift",
    name: "Identity Shift",
    tone: "intense, mindset-coded, slightly confrontational",
    description:
      "Calls out an identity the viewer is trapped in, names the cost, points at the new identity to step into.",
    matchPatterns: [
      /\b(identity|person|self|character|who\s+you\s+are)/i,
      /\b(confidence|self.?worth|self.?esteem|insecure)/i,
      /\b(quit|change|transform|reinvent)/i,
    ],
    hook: "Stop saying that about yourself.",
    hookVisual: "person mouth covered hand",
    setup:
      "Every time you say {topicShort} about yourself, you reinforce the wiring. The label slowly becomes the fact. The fact slowly becomes the future. None of that is metaphor.",
    setupVisual: "name tag sticker label",
    body: [
      "You are not a person who is bad at this. You are a person who has been practicing being bad at this for years.",
      "Those are different sentences. One is a sentence about your soul. The other is a sentence about your reps.",
      "Reps you can change. Souls you cannot.",
      "Pick the sentence that is actually true and useful, even when it feels like lying out loud.",
      "Speak about yourself in the new way before you believe it. The belief shows up after the language does, not before.",
      "The version of yourself you describe out loud is the version that quietly shows up to the next decision.",
    ],
    bodyVisuals: [
      "athlete training repetition",
      "two doors choice path",
      "blacksmith hammering metal",
      "mirror practice speech",
      "pen rewriting paper draft",
      "fork road decision",
    ],
    payoff:
      "Stop telling the story about who you have always been. Start telling the small honest story about who you are becoming. Then go act like that person for one full hour today.",
    payoffVisual: "open book new page",
    cta: "One hour. Today. Watch what changes inside you.",
    ctaVisual: "wristwatch hour close",
    alternateHooks: [
      "Stop saying that out loud.",
      "You are not your reps.",
      "{topicShort} is a label, not a fact.",
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "three_beat_story",
    name: "3-Beat Story",
    tone: "cinematic, slightly conspiratorial, story-driven",
    description:
      "Cold-open setup, escalation, twist, takeaway. Works for true-story / mystery / lesson content.",
    matchPatterns: [
      /\b(history|ancient|war|empire|founder|invent\w*)/i,
      /\b(secret|hidden|mystery|story|truth)/i,
      /\b(experiment|study|research|discover\w*)/i,
    ],
    hook: "{topicShort} hid one detail.",
    hookVisual: "old book hidden page",
    setup:
      "Everyone tells the same version of this story. The clean version. The version that fits in a textbook chapter and ends with a name you already know.",
    setupVisual: "library textbook stack",
    body: [
      "Here is what they leave out, every time, on purpose or by accident.",
      "The thing actually started years before anyone takes credit for it.",
      "Someone you have never heard of did the part that made the famous part possible.",
      "When the well-known version finally showed up, it took the work of a hundred people and put one name on it.",
      "That name became the story. The hundred people became a footnote in a citation almost nobody reads.",
      "If you only ever consume the textbook version, you will keep believing change comes from individuals. It almost never does.",
    ],
    bodyVisuals: [
      "magnifying glass document",
      "vintage workshop tools",
      "anonymous worker hands",
      "spotlight single person",
      "small footnote text",
      "crowd silhouettes shadow",
    ],
    payoff:
      "The credited person is usually the one who arrived last. The real movement happened quietly, in rooms nobody is watching, by people who will never get a Wikipedia page.",
    payoffVisual: "empty backstage room",
    cta: "Look for the unnamed people. They built the room.",
    ctaVisual: "construction workers blueprint",
    alternateHooks: [
      "Read between the textbook.",
      "Someone is missing.",
      "The story is wrong.",
    ],
  },
];

const FALLBACK_TEMPLATE_ID = "pattern_recognition";

export function getFallbackTemplate(): ScriptTemplate {
  const t = SCRIPT_TEMPLATES.find((s) => s.id === FALLBACK_TEMPLATE_ID);
  if (!t) throw new Error(`Fallback template ${FALLBACK_TEMPLATE_ID} missing`);
  return t;
}
