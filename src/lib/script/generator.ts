import { z } from "zod";
import { buildScriptPrompt, ScriptPromptInput } from "./prompt";
import { validateScript, ScriptValidationResult } from "./validate";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral";
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "mistralai/mistral-7b-instruct:free";

export const ScenePromptSchema = z.object({
  narration: z.string(),
  visualPrompt: z.string(),
  backgroundType: z.string(),
  estimatedSeconds: z.number(),
});
export type ScenePromptOutput = z.infer<typeof ScenePromptSchema>;

export const GeneratedScriptSchema = z.object({
  script: z.string().min(1),
  alternateHooks: z.array(z.string()).min(0).max(5),
  structure: z.object({
    hook: z.string(),
    setup: z.string(),
    points: z.array(z.string()),
    payoff: z.string(),
    cta: z.string(),
  }),
  scenePrompts: z.array(ScenePromptSchema),
  captionLines: z.array(z.string()),
  wordCount: z.number(),
});
export type GeneratedScript = z.infer<typeof GeneratedScriptSchema>;

export type ScriptGeneratorProvider = "ollama" | "openrouter" | "deterministic";

export interface ScriptGenerationResult {
  generated: GeneratedScript;
  provider: ScriptGeneratorProvider;
  validation: ScriptValidationResult;
}

function extractJSON(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in response");
  }
  return text.slice(start, end + 1);
}

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.85 },
    }),
    // 4 minutes — first call after Ollama starts loads the model into RAM
    // and that alone can take 60–120s on a CPU-only machine.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { response: string };
  return data.response;
}

async function callOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost:3001",
      "X-Title": "Short Form Video System",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: "You write 60-second short-form video scripts. Return only valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content ?? "";
  if (!content) throw new Error("Empty OpenRouter response");
  return content;
}

function parseGenerated(raw: string): GeneratedScript {
  const json = JSON.parse(extractJSON(raw));
  const result = GeneratedScriptSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

// ─── Deterministic fallback ──────────────────────────────────────────────────
// Builds a structurally-correct 60s script template from the topic alone.
// Quality is unavoidably generic, but it always passes the structural validator
// and never crashes the pipeline. Surface a clear warning when used.

function deterministicScript(input: ScriptPromptInput): GeneratedScript {
  const topic = input.topic.trim();
  const niche = input.niche ?? "this";

  // Hook: ≤ 4 topic words + " lies to you." → ≤ 7 words total, ~2.4s at
  // 150 wpm. The structural validator wants ≤ 2.5s; the brief wants ≤ 3s
  // for retention. Aggressively truncating the topic phrase is fine — the
  // hook only needs to point at the subject, not describe it.
  const topicWords = topic.replace(/[.,;:!?]+$/g, "").split(/\s+/);
  // Drop connector words that produce broken phrases like
  // "procrastinating simple tasks because they".
  const stopAtConnectors = new Set([
    "because", "and", "but", "while", "since", "though", "they", "the",
    "with", "without", "from", "for", "about", "of", "on", "in", "at",
    "to", "as", "if", "when", "than", "that", "this", "these", "those",
  ]);
  const hookWords: string[] = [];
  for (const w of topicWords) {
    if (hookWords.length >= 3) break;
    if (stopAtConnectors.has(w.toLowerCase())) break;
    hookWords.push(w);
  }
  const hookCore = hookWords.join(" ").trim() || topicWords.slice(0, 2).join(" ");
  const hook = `${hookCore} lies to you.`;

  // Setup — ~15 words.
  const setup = `Most people misread ${niche} because the obvious story is wrong, and the real one is uncomfortable.`;

  // Three body points — designed together to total ~75 words. The pattern
  // is generic on purpose; the structural validator passes and the user can
  // edit before rendering.
  const points = [
    `It starts smaller than you think. One quiet decision, repeated. Then a second one, because the first felt safe. Most days nothing visible changes.`,
    `The cost compounds in the background. Every skipped step makes the next one heavier. Every missed signal trains you to ignore the one after.`,
    `By the time you notice, the pattern feels like personality. You stop calling it a choice. You start calling it who you are.`,
  ];

  // Payoff — ~28 words, the reframe.
  const payoff = `Here is the part nobody says out loud. The fix is not motivation, and it is not discipline. It is making the smallest move you can name impossible to skip.`;

  // CTA — ~14 words.
  const cta =
    input.ctaStyle === "none"
      ? `Pick the smallest move. Pick the same one tomorrow. That is the entire change.`
      : `Pick one tiny move. Do it before you finish reading this sentence.`;

  const script = [hook, setup, ...points, payoff, cta].join(" ");

  const alternateHooks = [
    `Here's what nobody admits.`,
    `This pattern is invisible.`,
    `You are not lazy.`,
  ];

  const scenePrompts: ScenePromptOutput[] = [
    {
      narration: hook,
      visualPrompt: `extreme close-up of hands hesitating over phone screen, dark room, single lamp, cool blue glow, shallow depth of field`,
      backgroundType: "stockImage",
      estimatedSeconds: 3,
    },
    {
      narration: setup,
      visualPrompt: `medium shot person sitting at cluttered desk, soft window light, paused mid-task, tone neutral and observational`,
      backgroundType: "stockImage",
      estimatedSeconds: 7,
    },
    {
      narration: points[0],
      visualPrompt: `close-up cursor blinking on empty document, late night ambient light, monitor reflection on glasses`,
      backgroundType: "stockImage",
      estimatedSeconds: 10,
    },
    {
      narration: points[1],
      visualPrompt: `tracking shot stack of unopened envelopes growing on kitchen counter, morning light, slow push-in`,
      backgroundType: "evidenceCard",
      estimatedSeconds: 12,
    },
    {
      narration: points[2],
      visualPrompt: `overhead shot calendar with identical days marked the same, hand placing one more X, muted palette`,
      backgroundType: "stockImage",
      estimatedSeconds: 13,
    },
    {
      narration: payoff,
      visualPrompt: `low angle pen touching paper for the first time, warm directional light, slight exhale visible`,
      backgroundType: "quoteCard",
      estimatedSeconds: 10,
    },
    {
      narration: cta,
      visualPrompt: `medium shot subject standing in doorway, light flooding in, calm shoulders dropping, decisive`,
      backgroundType: "textCard",
      estimatedSeconds: 5,
    },
  ];

  const captionLines = scenePrompts.map((s) =>
    s.narration.split(/\s+/).slice(0, 5).join(" ")
  );

  return {
    script,
    alternateHooks,
    structure: { hook, setup, points, payoff, cta },
    scenePrompts,
    captionLines,
    wordCount: script.split(/\s+/).filter(Boolean).length,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateScript(
  input: ScriptPromptInput
): Promise<ScriptGenerationResult> {
  const prompt = buildScriptPrompt(input);

  // Try Ollama
  if (await isOllamaAvailable()) {
    try {
      console.info("[script] Generating via Ollama");
      const raw = await callOllama(prompt);
      const generated = parseGenerated(raw);
      const validation = validateScript(generated.script);
      return { generated, provider: "ollama", validation };
    } catch (err) {
      console.warn(`[script:ollama] failed: ${err}`);
    }
  } else {
    console.info("[script] Ollama not available, skipping");
  }

  // Try OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    try {
      console.info("[script] Generating via OpenRouter");
      const raw = await callOpenRouter(prompt);
      const generated = parseGenerated(raw);
      const validation = validateScript(generated.script);
      return { generated, provider: "openrouter", validation };
    } catch (err) {
      console.warn(`[script:openrouter] failed: ${err}`);
    }
  } else {
    console.info("[script] OpenRouter API key not set, skipping");
  }

  // Deterministic fallback
  console.info("[script] Using deterministic template fallback");
  const generated = deterministicScript(input);
  const validation = validateScript(generated.script);
  return { generated, provider: "deterministic", validation };
}
