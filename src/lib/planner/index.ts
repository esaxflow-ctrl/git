import { ScenePlan, PlannerOptions } from "../validation/schemas";
import { validateScenePlan } from "../validation/antiGeneric";
import { isOllamaAvailable, generateWithOllama } from "./ollama";
import { generateWithOpenRouter } from "./openrouter";
import { generateDeterministic } from "./deterministic";

export type PlannerProvider = "ollama" | "openrouter" | "deterministic";

export interface PlannerResult {
  scenes: ScenePlan[];
  provider: PlannerProvider;
}

async function tryProvider(
  name: PlannerProvider,
  fn: () => Promise<ScenePlan[]>,
  options: PlannerOptions
): Promise<ScenePlan[] | null> {
  try {
    const scenes = await fn();
    const validation = validateScenePlan(scenes);
    if (validation.valid) return scenes;

    console.warn(`[planner:${name}] validation failed: ${validation.reason}. Retrying...`);
    // Retry once
    const retry = await fn();
    const retryValidation = validateScenePlan(retry);
    if (retryValidation.valid) return retry;

    console.warn(`[planner:${name}] retry also failed: ${retryValidation.reason}`);
    return null;
  } catch (err) {
    console.warn(`[planner:${name}] error: ${err}`);
    return null;
  }
}

export async function generateScenes(
  script: string,
  options: PlannerOptions
): Promise<PlannerResult> {
  const demo = process.env.DEMO_MODE === "1";

  if (demo) {
    console.info("[planner] DEMO_MODE=1 — using deterministic planner only");
    const scenes = await generateDeterministic(script, options);
    return { scenes, provider: "deterministic" };
  }

  // Try Ollama first (local, free)
  if (await isOllamaAvailable()) {
    const scenes = await tryProvider(
      "ollama",
      () => generateWithOllama(script, options),
      options
    );
    if (scenes) return { scenes, provider: "ollama" };
  } else {
    console.info("[planner] Ollama not available, skipping");
  }

  // Try OpenRouter (cloud, requires API key)
  if (process.env.OPENROUTER_API_KEY) {
    const scenes = await tryProvider(
      "openrouter",
      () => generateWithOpenRouter(script, options),
      options
    );
    if (scenes) return { scenes, provider: "openrouter" };
  } else {
    console.info("[planner] OpenRouter API key not set, skipping");
  }

  // Guaranteed deterministic fallback
  console.info("[planner] Using deterministic fallback");
  const scenes = await generateDeterministic(script, options);
  return { scenes, provider: "deterministic" };
}
