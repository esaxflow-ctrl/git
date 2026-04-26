// Prompt template for LLM script generation. Targets a 58–62s voiceover.

export interface ScriptPromptInput {
  topic: string;
  niche?: string;
  tone?: string;
  targetViewer?: string;
  visualStyle?: string;
  voiceStyle?: string;
  ctaStyle?: string;
  platform?: string;
  referenceStyle?: string;
  bannedPhrases?: string[];
}

export function buildScriptPrompt(input: ScriptPromptInput): string {
  const banned = input.bannedPhrases?.length
    ? input.bannedPhrases.join(", ")
    : "(none specified)";

  return `You are a senior short-form video writer for TikTok, Reels, and Shorts.

Write ONE 60-second voiceover script (target 145 words, hard band 135–165) on this topic:
"""${input.topic}"""

CONTEXT
- Niche: ${input.niche ?? "general"}
- Tone: ${input.tone ?? "sharp, direct, emotionally honest"}
- Target viewer: ${input.targetViewer ?? "scrolling general audience"}
- Voice style: ${input.voiceStyle ?? "calm, intense, conversational"}
- CTA style: ${input.ctaStyle ?? "subtle, no asking for likes"}
- Platform: ${input.platform ?? "TikTok / Reels / Shorts"}
- Reference style cue: ${input.referenceStyle ?? "(none)"}
- BANNED phrases the viewer must NOT hear: ${banned}

STRUCTURE (mandatory, exact timing)
- 0–3s    Hook: ≤6 spoken words, no questions starting with "Did you know" or "Hey guys" or "Here's"
- 3–10s   Setup: one sentence that frames the tension or stakes
- 10–45s  Three tight points / story beats / insights — each 1–2 short sentences
- 45–55s  Payoff: the reframe, twist, or punchline
- 55–60s  Closer: ${input.ctaStyle === "none" ? "a final landing line, no call to action" : "natural CTA or final punchline"}

WRITING RULES
- 8th-grade reading level
- Short spoken sentences (≤18 words each)
- High curiosity. Strong emotional pull. Visual potential in every line.
- No "Did you know", "Here's", "Hey guys", "Imagine if", "You won't believe"
- No corporate motivational filler ("level up", "unlock the secret", "game-changer", "harness the power")
- No repetitive phrases. No overexplaining. No throat-clearing.
- Each sentence should make a reader want the next one.

OUTPUT FORMAT — return ONLY this JSON object, no markdown:
{
  "script": "<full 145-word script as plain text, sentences separated by spaces>",
  "alternateHooks": [
    "<alt hook 1 — ≤6 words>",
    "<alt hook 2 — ≤6 words>",
    "<alt hook 3 — ≤6 words>"
  ],
  "structure": {
    "hook": "<the hook sentence>",
    "setup": "<the setup sentence>",
    "points": ["<point 1>", "<point 2>", "<point 3>"],
    "payoff": "<the payoff sentence>",
    "cta": "<the closer sentence>"
  },
  "scenePrompts": [
    { "narration": "<sentence(s) covered>", "visualPrompt": "<cinematic 15-25 word shot description>", "backgroundType": "<one of: stockVideo, stockImage, gradientMotionCard, evidenceCard, quoteCard, textCard>", "estimatedSeconds": <int> }
  ],
  "captionLines": ["<short on-screen caption per scene, ≤6 words>"],
  "wordCount": <int>
}

CRITICAL: Each scenePrompts entry's visualPrompt must be specific (subject + action + setting + lighting + camera), not generic. Avoid words: nature, city, people, business, technology, abstract, lifestyle, motivation, success, beauty.

Return ONLY the JSON object.`;
}
