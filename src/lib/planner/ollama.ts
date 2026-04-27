import { ScenePlan, ScenePlanSchema, PlannerOptions } from "../validation/schemas";
import { z } from "zod";
import { buildPlannerPrompt } from "./prompt";
import { parseLlmJson, coerceScenePlanShape } from "../llm/repair";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral";

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
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
      options: { temperature: 0.7 },
    }),
    // First request after Ollama starts has to load the model into RAM
    // (~2 GB for llama3.2:3b, slower on CPU-only). Subsequent requests
    // are much faster — but the first call routinely hits 60–120s, so
    // we give it 4 minutes before giving up.
    signal: AbortSignal.timeout(240_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { response: string };
  return data.response;
}

export async function generateWithOllama(
  script: string,
  options: PlannerOptions
): Promise<ScenePlan[]> {
  const prompt = buildPlannerPrompt(script, options);
  let raw: string;

  try {
    raw = await callOllama(prompt);
  } catch (err) {
    throw new Error(`Ollama call failed: ${err}`);
  }

  // Robust parse: strips comments / trailing commas, then coerces common
  // type mismatches (emphasisWords / searchTerms returned as strings).
  let parsed: unknown;
  try {
    parsed = parseLlmJson(raw, "array", coerceScenePlanShape);
  } catch (err) {
    // Retry once with a stricter prompt.
    const retryPrompt =
      prompt +
      "\n\nIMPORTANT: Return ONLY the JSON array. No text before or after. " +
      "emphasisWords and searchTerms MUST be JSON arrays of strings, e.g. [\"word1\", \"word2\"], not space-separated strings.";
    raw = await callOllama(retryPrompt);
    parsed = parseLlmJson(raw, "array", coerceScenePlanShape);
    void err;
  }

  const result = z.array(ScenePlanSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`Ollama response failed schema validation: ${result.error.message}`);
  }

  return result.data;
}
