import { PlannerOptions } from "../validation/schemas";

export function buildPlannerPrompt(script: string, options: PlannerOptions): string {
  const { minScenes, maxScenes, targetDurationSeconds } = options;

  return `You are a cinematic video scene director for short-form vertical video (9:16, 60-75 seconds).

Your job: break this script into scenes where EVERY visual feels intentionally art-directed, emotionally matched, and specific. No generic stock imagery. No filler visuals.

Return ONLY a valid JSON array. No markdown, no explanation, no text outside the JSON.

Each scene object must have EXACTLY these fields:
- id: "scene-1", "scene-2", etc.
- narration: the exact spoken text for this scene
- caption: 4-8 punchy words that capture the scene's emotional core
- searchTerms: array of 2-3 HIGHLY SPECIFIC search terms (see rules below)
- visualMode: one of: "stockVideo", "stockImage", "gradientMotionCard", "textCard", "quoteCard", "evidenceCard", "mapCard", "timelineCard"
- emphasisWords: 0-3 words from the caption that carry the emotional punch
- mood: single evocative word (e.g., "dread", "relief", "defiant", "hollow", "restless")
- sceneGoal: what this scene makes the viewer FEEL or UNDERSTAND (8-12 words)
- visualRole: one of: "hook", "evidence", "climax", "resolution", "transition"
- pacing: one of: "fast", "medium", "slow", "dramatic_pause"
- durationHint: seconds (4-15)
- visualPurpose: one of: "show_behavior", "show_emotion", "show_consequence", "show_reframe", "show_action"
- cinematicPrompt: a specific 20-40 word visual description (see format below)

SEARCH TERM RULES — this is critical:
- Each search term must create a strong mental image on its own
- Include shot type, subject, action, and setting — NOT just nouns
- GOOD: "close up hands trembling coffee cup morning", "person staring phone screen dark room 3am", "unopened mail pile kitchen table anxiety"
- BAD: "anxiety", "procrastination", "person sad", "office", "technology", "stress"
- Prefer: specific locations, specific actions, specific body language, specific times of day
- Never use: "nature", "city", "people", "background", "business", "technology", "abstract", "lifestyle", "motivation", "success", "happiness", "beauty"

CINEMATIC PROMPT FORMAT:
Write as a director's shot description: [shot type] of [subject] [action], [setting], [time of day if relevant], [lighting], [emotional tone], [color palette], [what to avoid]
Example: "extreme close-up of hand hovering over phone screen, dark bedroom, only screen glow illuminating face, anxious stillness, cool blue light, avoid generic stock smile"

VISUAL MODE SELECTION:
- "stockVideo" or "stockImage": when a real-world scene would be most powerful
- "gradientMotionCard": for abstract emotional openings or atmosphere-setting
- "textCard": for shocking facts, short punchy statements, dramatic reveals
- "quoteCard": for internal monologue, spoken phrases the viewer recognizes themselves saying
- "evidenceCard": for data, statistics, research findings, named patterns
- "timelineCard": for progression, before/after, sequences of events
- "mapCard": for scale, reach, geographic or systemic scope

VISUAL VARIETY RULES:
- No more than 2 consecutive scenes with the same visualMode
- Use close-up detail shots for at least 2 scenes (hands, face, phone, desk, objects)
- Include at least 1 environmental/wide shot
- Vary between: intimate close-ups, environmental context, symbolic objects, emotional body language
- Avoid repeating "person looking sad at camera" or "person at desk" in consecutive scenes
- If one scene shows a person, the next should show an object, environment, or symbolic detail

VISUAL PURPOSE TAXONOMY:
- "show_behavior": show the exact behavioral pattern being described (the habit, the avoidance, the ritual)
- "show_emotion": show what this FEELS like from the inside (visceral, not illustrative)
- "show_consequence": show what happens as a result of this pattern
- "show_reframe": show a perspective shift — what this looks like from outside or from the future
- "show_action": show the specific action step or solution being described

QUALITY CHECKER — REJECT a visual if any of these are true:
- The visual could fit any script about any topic
- The searchTerms don't create a clear mental picture of something specific
- The shot type isn't specified in the cinematicPrompt
- The visual is the same type as the previous scene
- The prompt lacks a subject doing something in a specific place

SCENE STRUCTURE RULES:
1. Create ${minScenes}-${maxScenes} scenes totaling ~${targetDurationSeconds}s at 150 words/minute
2. First scene: visualRole "hook", visualPurpose "show_emotion" or "show_behavior"
3. Last scene: visualRole "resolution", visualPurpose "show_action" or "show_reframe"
4. Include at least 3 different visualRole values
5. Pacing must vary — no more than 3 consecutive scenes with same pacing
6. Each scene must earn its place — if a scene could be cut without losing meaning, merge it

Script to plan:
"""
${script}
"""

Return ONLY the JSON array. No markdown, no explanation.`;
}
