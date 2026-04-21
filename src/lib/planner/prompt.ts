import { PlannerOptions } from "../validation/schemas";

export function buildPlannerPrompt(script: string, options: PlannerOptions): string {
  const { minScenes, maxScenes, targetDurationSeconds } = options;

  return `You are a video scene planner for short-form vertical video (9:16 format, 60-75 seconds).

Return ONLY a valid JSON array of scene objects with NO explanation or markdown.

Each scene object must have EXACTLY these fields:
- id: a unique string (use uuid-style like "scene-1", "scene-2", etc.)
- narration: the spoken text for this scene (string)
- caption: a short punchy caption, max 8 words (string)
- searchTerms: 2-3 SPECIFIC search terms for stock footage, NOT generic words like "nature", "city", "people", "background" (array of strings)
- visualMode: one of: "stockVideo", "stockImage", "gradientMotionCard", "textCard", "quoteCard", "evidenceCard", "mapCard", "timelineCard"
- emphasisWords: 0-3 words from the caption to emphasize (array of strings)
- mood: one word describing the emotional tone (string)
- sceneGoal: what this scene accomplishes narratively (string, 5-10 words)
- visualRole: one of: "hook", "evidence", "climax", "resolution", "transition"
- pacing: one of: "fast", "medium", "slow", "dramatic_pause"
- durationHint: estimated seconds this scene should last (number, 4-15)

Rules:
1. Create ${minScenes}-${maxScenes} scenes totaling ~${targetDurationSeconds} seconds when narration is read at 150 words/minute
2. searchTerms must be SPECIFIC (NOT: "nature", "city", "people", "background", "business", "technology", "abstract", "lifestyle")
3. visualMode must VARY across scenes — no more than 60% of scenes may use the same mode
4. Include at least 3 different visualRole values across all scenes
5. The first scene must have visualRole "hook"
6. The last scene must have visualRole "resolution"
7. Pacing should vary throughout

Script to plan:
"""
${script}
"""

Return ONLY the JSON array. No markdown, no explanation.`;
}
