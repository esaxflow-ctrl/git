// LLM polish for template-generated scripts.
//
// The template library produces structurally-correct scripts but they all
// share the same prose patterns — three videos in a row from the same
// channel will start to feel templated even when the topics differ.
// Polish runs the filled script through a local Ollama model with a tight
// rewrite prompt: "same structure, same word count, same hook word count,
// punchier conversational tone." The structure is preserved exactly; the
// model only changes word choice and rhythm.
//
// If Ollama isn't reachable or the polish output fails validation, we
// silently fall back to the unpolished template. Polish is opt-in via
// ENABLE_SCRIPT_POLISH=1 so users without Ollama don't pay a 30s wait.

import { z } from "zod";
import { GeneratedScript } from "./generator";
import { parseLlmJson } from "../llm/repair";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral";

const PolishedSchema = z.object({
  hook: z.string().min(1),
  setup: z.string().min(1),
  body: z.array(z.string()).min(3).max(8),
  payoff: z.string().min(1),
  cta: z.string().min(1),
});

function buildPolishPrompt(s: GeneratedScript): string {
  const beats = [
    `HOOK (${s.structure.hook.split(/\s+/).length} words): "${s.structure.hook}"`,
    `SETUP: "${s.structure.setup}"`,
    ...s.structure.points.map((p, i) => `BODY ${i + 1}: "${p}"`),
    `PAYOFF: "${s.structure.payoff}"`,
    `CTA: "${s.structure.cta}"`,
  ].join("\n");

  return `You are a short-form video script editor. Rewrite the following 60-second script so it sounds more conversational and less templated, while preserving the structure exactly.

HARD RULES — break any of these and the rewrite is rejected:
- Keep the same number of body beats (do not add or remove sentences).
- Keep the hook ≤ 6 words.
- Keep total word count between 155 and 185 words.
- Keep the meaning of each beat. Do not change the message.
- Use 8th-grade reading level. Short spoken sentences. No filler.
- BANNED phrases: "did you know", "here's", "hey guys", "let me tell you",
  "in today's", "imagine if", "you won't believe", "level up", "unlock",
  "harness the power", "game-changer", "next level", "but wait there's more".

INPUT SCRIPT:
${beats}

Return ONLY this JSON object, nothing else:
{
  "hook": "<rewritten hook ≤6 words>",
  "setup": "<rewritten setup>",
  "body": ["<rewritten body 1>", "<rewritten body 2>", "..."],
  "payoff": "<rewritten payoff>",
  "cta": "<rewritten CTA>"
}`;
}

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.6 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { response: string };
  return data.response;
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

export interface PolishResult {
  polished: GeneratedScript;
  applied: boolean;
  reason?: string;
}

export async function polishScript(s: GeneratedScript): Promise<PolishResult> {
  if (process.env.ENABLE_SCRIPT_POLISH !== "1") {
    return { polished: s, applied: false, reason: "ENABLE_SCRIPT_POLISH not set" };
  }
  if (!(await isOllamaAvailable())) {
    return { polished: s, applied: false, reason: "Ollama not reachable" };
  }

  try {
    console.info("[script:polish] Polishing template via Ollama");
    const raw = await callOllama(buildPolishPrompt(s));
    const parsed = parseLlmJson(raw, "object");
    const result = PolishedSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[script:polish] schema mismatch — using unpolished. ${result.error.message.slice(0, 200)}`);
      return { polished: s, applied: false, reason: "schema mismatch" };
    }

    const p = result.data;
    const newScript = [p.hook, p.setup, ...p.body, p.payoff, p.cta].join(" ");
    const newWordCount = newScript.split(/\s+/).filter(Boolean).length;

    // Sanity gates: hook length and total word count must stay in band.
    const hookWords = p.hook.split(/\s+/).filter(Boolean).length;
    if (hookWords > 7) {
      console.warn(`[script:polish] hook is ${hookWords} words — keeping unpolished`);
      return { polished: s, applied: false, reason: "hook too long" };
    }
    if (newWordCount < 130 || newWordCount > 200) {
      console.warn(`[script:polish] total ${newWordCount} words — keeping unpolished`);
      return { polished: s, applied: false, reason: "word count out of band" };
    }
    if (p.body.length !== s.structure.points.length && p.body.length < 3) {
      console.warn(`[script:polish] body shrank to ${p.body.length} beats — keeping unpolished`);
      return { polished: s, applied: false, reason: "body too short" };
    }

    // Build a polished GeneratedScript that mirrors the input shape.
    const points = p.body.length >= 3 ? p.body.slice(0, Math.max(3, p.body.length)) : p.body;
    const captionLines = [p.hook, p.setup, ...p.body, p.payoff, p.cta].map((b) =>
      b.split(/\s+/).slice(0, 6).join(" ")
    );
    // Re-derive scenePrompts from the new beats — just keep the original
    // visual prompts since they're tied to topic, not exact prose.
    const scenePrompts = s.scenePrompts.slice(0, [p.hook, p.setup, ...p.body, p.payoff, p.cta].length);

    return {
      polished: {
        script: newScript,
        alternateHooks: s.alternateHooks,
        structure: { hook: p.hook, setup: p.setup, points, payoff: p.payoff, cta: p.cta },
        scenePrompts,
        captionLines,
        wordCount: newWordCount,
      },
      applied: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[script:polish] error: ${msg.slice(0, 200)}. Using unpolished.`);
    return { polished: s, applied: false, reason: "error" };
  }
}
