import { ScenePlan, ScenePlanSchema, PlannerOptions } from "../validation/schemas";
import { z } from "zod";
import { buildPlannerPrompt } from "./prompt";
import { parseLlmJson, coerceScenePlanShape } from "../llm/repair";

const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "mistralai/mistral-7b-instruct:free";

export async function generateWithOpenRouter(
  script: string,
  options: PlannerOptions
): Promise<ScenePlan[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const prompt = buildPlannerPrompt(script, options);

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
          content: "You are a video scene planner. Return only valid JSON arrays.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");

  const parsed = parseLlmJson(content, "array", coerceScenePlanShape);
  const result = z.array(ScenePlanSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`OpenRouter response failed schema validation: ${result.error.message}`);
  }

  return result.data;
}
