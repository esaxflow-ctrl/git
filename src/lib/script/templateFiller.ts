// Pick the best template for a topic, fill its slots, and emit a ready-to-
// validate GeneratedScript shape. This is the deterministic-but-decent
// scripts path the user asked for — no LLM dependency.

import { v4 as uuidv4 } from "uuid";
import { ScriptTemplate, SCRIPT_TEMPLATES, getFallbackTemplate } from "./templates";
import { ScriptPromptInput } from "./prompt";
import { GeneratedScript, ScenePromptOutput } from "./generator";

void uuidv4;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "of", "in", "on", "at", "to",
  "with", "without", "for", "from", "by", "as", "is", "are", "was",
  "were", "be", "been", "being", "they", "them", "their", "this",
  "that", "these", "those", "because", "while", "though", "since",
  "you", "your", "i", "we", "our", "my", "me", "us",
]);

function trimSentencePunctuation(s: string): string {
  return s.replace(/[.,;:!?]+$/g, "").trim();
}

function topicShort(topic: string): string {
  const words = trimSentencePunctuation(topic).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 3) break;
    if (STOP_WORDS.has(w.toLowerCase())) continue;
    out.push(w);
  }
  return out.join(" ") || words.slice(0, 2).join(" ") || topic;
}

function topicNoun(topic: string): string {
  const words = trimSentencePunctuation(topic).split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (!STOP_WORDS.has(w.toLowerCase())) return w;
  }
  return words[0] ?? topic;
}

function fillSlots(
  text: string,
  ctx: { topic: string; topicShort: string; topicNoun: string; niche: string }
): string {
  return text
    .replaceAll("{topicShort}", ctx.topicShort)
    .replaceAll("{topicNoun}", ctx.topicNoun)
    .replaceAll("{topic}", ctx.topic)
    .replaceAll("{niche}", ctx.niche);
}

export function pickTemplate(input: ScriptPromptInput): ScriptTemplate {
  const blob = `${input.topic} ${input.niche ?? ""}`;
  for (const tpl of SCRIPT_TEMPLATES) {
    for (const pattern of tpl.matchPatterns) {
      if (pattern.test(blob)) return tpl;
    }
  }
  return getFallbackTemplate();
}

function buildScenePrompts(
  filledHook: string,
  filledSetup: string,
  filledBody: string[],
  filledPayoff: string,
  filledCta: string,
  topicNounValue: string,
  hookVisual: string,
  setupVisual: string,
  bodyVisuals: string[],
  payoffVisual: string,
  ctaVisual: string
): ScenePromptOutput[] {
  // Per-beat visual hints curated in the template, so each scene's search
  // term actually depicts the line being spoken instead of cycling a
  // generic topic anchor.
  const scenes: ScenePromptOutput[] = [];
  const beats = [filledHook, filledSetup, ...filledBody, filledPayoff, filledCta];
  const visualHints = [hookVisual, setupVisual, ...bodyVisuals, payoffVisual, ctaVisual];

  beats.forEach((narration, i) => {
    const wordCount = narration.split(/\s+/).length;
    const estimatedSeconds = Math.max(2, Math.round((wordCount / 170) * 60));
    const hint = visualHints[i] ?? topicNounValue;
    scenes.push({
      narration,
      // visualPrompt now carries the curated Pexels search term. The planner
      // uses this directly when prebuilt scenes are passed through.
      visualPrompt: hint,
      backgroundType: "stockImage",
      estimatedSeconds,
    });
  });
  return scenes;
}

function buildCaptionLines(beats: string[]): string[] {
  return beats.map((beat) => beat.split(/\s+/).slice(0, 6).join(" "));
}

export function fillTemplate(
  template: ScriptTemplate,
  input: ScriptPromptInput
): GeneratedScript {
  const ctx = {
    topic: input.topic.trim(),
    topicShort: topicShort(input.topic),
    topicNoun: topicNoun(input.topic),
    niche: input.niche ?? "this",
  };

  const hook = fillSlots(template.hook, ctx);
  const setup = fillSlots(template.setup, ctx);
  const body = template.body.map((b) => fillSlots(b, ctx));
  const payoff = fillSlots(template.payoff, ctx);
  const cta = fillSlots(template.cta, ctx);

  const script = [hook, setup, ...body, payoff, cta].join(" ");
  const wordCount = script.split(/\s+/).filter(Boolean).length;

  const points = body.length >= 3 ? body.slice(0, 3) : body;

  const scenePrompts = buildScenePrompts(
    hook,
    setup,
    body,
    payoff,
    cta,
    ctx.topicNoun,
    template.hookVisual,
    template.setupVisual,
    template.bodyVisuals,
    template.payoffVisual,
    template.ctaVisual
  );
  const captionLines = buildCaptionLines([hook, setup, ...body, payoff, cta]);

  const alternateHooks = template.alternateHooks
    .map((h) => fillSlots(h, ctx))
    .slice(0, 5);

  return {
    script,
    alternateHooks,
    structure: { hook, setup, points, payoff, cta },
    scenePrompts,
    captionLines,
    wordCount,
  };
}
