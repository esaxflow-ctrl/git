import { ScenePlan, ScenePlanSchema, PlannerOptions } from "../validation/schemas";
import { z } from "zod";
import { buildPlannerPrompt } from "./prompt";

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

function extractJSON(text: string): string {
  // Find first '[' and last ']'
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in response");
  return text.slice(start, end + 1);
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

  let jsonStr: string;
  try {
    jsonStr = extractJSON(raw);
  } catch {
    // Retry with stricter prompt
    const retryPrompt = prompt + "\n\nIMPORTANT: Return ONLY the JSON array. No text before or after it.";
    raw = await callOllama(retryPrompt);
    jsonStr = extractJSON(raw);
  }

  const parsed = JSON.parse(jsonStr);
  const result = z.array(ScenePlanSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`Ollama response failed schema validation: ${result.error.message}`);
  }

  return result.data;
}
