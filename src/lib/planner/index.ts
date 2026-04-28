import { v4 as uuidv4 } from "uuid";
import {
  ScenePlan,
  PlannerOptions,
  PrebuiltScene,
  VisualPurpose,
  VisualRole,
  PacingMode,
  VisualMode,
} from "../validation/schemas";
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

// ─── Prebuilt-scenes path ────────────────────────────────────────────────────
// Used when the script came from a template — the template already emitted
// a per-beat visual hint per narration segment. We skip text-derivation
// entirely and just wrap each beat as a ScenePlan with the curated hint
// as its primary search term.

const PURPOSE_BY_INDEX: VisualPurpose[] = [
  "show_emotion",
  "show_behavior",
  "show_consequence",
  "show_reframe",
  "show_action",
];

const ROLE_BY_INDEX: VisualRole[] = [
  "hook",
  "evidence",
  "evidence",
  "evidence",
  "climax",
  "evidence",
  "climax",
  "resolution",
  "transition",
];

const PACING_BY_INDEX: PacingMode[] = [
  "fast",
  "medium",
  "slow",
  "fast",
  "medium",
  "dramatic_pause",
  "fast",
  "medium",
];

export function buildScenesFromPrebuilt(
  prebuilt: PrebuiltScene[],
  _options: PlannerOptions,
  _scriptContext: string
): ScenePlan[] {
  return prebuilt.map((p, i) => {
    const isFirst = i === 0;
    const isLast = i === prebuilt.length - 1;

    const purpose: VisualPurpose = isFirst
      ? "show_emotion"
      : isLast
      ? "show_action"
      : PURPOSE_BY_INDEX[Math.min(i, PURPOSE_BY_INDEX.length - 1)];

    // Single curated search term — the per-beat visual hint. If Pexels
    // returns 0 results for it, our adapter's mood/purpose fallback
    // varies per scene so we don't end up with duplicate photos.
    const searchTerms = [p.visualHint].filter((s) => s && s.length >= 2);
    if (searchTerms.length === 0) searchTerms.push("morning light");

    const captionWords = p.narration.split(/\s+/).slice(0, 6).join(" ");

    return {
      id: uuidv4(),
      narration: p.narration,
      caption: captionWords,
      searchTerms,
      visualMode: "stockImage" as VisualMode,
      emphasisWords: [],
      mood: "neutral",
      sceneGoal: isFirst
        ? "hook the viewer with visceral emotional recognition"
        : isLast
        ? "give the viewer a clear action to take"
        : "deepen the emotional or conceptual understanding",
      visualRole: ROLE_BY_INDEX[Math.min(i, ROLE_BY_INDEX.length - 1)],
      pacing: isFirst ? "fast" : PACING_BY_INDEX[Math.min(i, PACING_BY_INDEX.length - 1)],
      durationHint: Math.max(3, Math.min(15, Math.round((p.narration.split(/\s+/).length / 170) * 60))),
      visualPurpose: purpose,
      cinematicPrompt: p.visualHint,
    };
  });
}
