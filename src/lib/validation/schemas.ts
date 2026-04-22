import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const VisualModeSchema = z.enum([
  "stockVideo",
  "stockImage",
  "gradientMotionCard",
  "textCard",
  "quoteCard",
  "evidenceCard",
  "mapCard",
  "timelineCard",
]);
export type VisualMode = z.infer<typeof VisualModeSchema>;

export const PacingModeSchema = z.enum(["fast", "medium", "slow", "dramatic_pause"]);
export type PacingMode = z.infer<typeof PacingModeSchema>;

export const VisualRoleSchema = z.enum([
  "hook",
  "evidence",
  "climax",
  "resolution",
  "transition",
]);
export type VisualRole = z.infer<typeof VisualRoleSchema>;

export const VisualPurposeSchema = z.enum([
  "show_behavior",
  "show_emotion",
  "show_consequence",
  "show_reframe",
  "show_action",
]);
export type VisualPurpose = z.infer<typeof VisualPurposeSchema>;

export const CaptionAnimationSchema = z.enum([
  "word_pop",
  "phrase_slide",
  "karaoke",
  "typewriter",
]);
export type CaptionAnimation = z.infer<typeof CaptionAnimationSchema>;

export const MotionStyleSchema = z.enum([
  "ken_burns",
  "drift",
  "zoom_in",
  "static",
  "parallax",
]);
export type MotionStyle = z.infer<typeof MotionStyleSchema>;

export const TransitionStyleSchema = z.enum([
  "cut",
  "fade",
  "glitch",
  "wipe",
  "zoom_through",
]);
export type TransitionStyle = z.infer<typeof TransitionStyleSchema>;

export const NarrationStyleSchema = z.enum([
  "dramatic",
  "calm",
  "urgent",
  "conspiratorial",
  "authoritative",
]);
export type NarrationStyle = z.infer<typeof NarrationStyleSchema>;

// ─── Core Entities ────────────────────────────────────────────────────────────

export const WordTimingSchema = z.object({
  word: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const ScenePlanSchema = z.object({
  id: z.string(),
  narration: z.string().min(1),
  caption: z.string().min(1).max(120),
  searchTerms: z.array(z.string()).min(1).max(4),
  visualMode: VisualModeSchema,
  emphasisWords: z.array(z.string()),
  mood: z.string(),
  sceneGoal: z.string(),
  visualRole: VisualRoleSchema,
  pacing: PacingModeSchema,
  durationHint: z.number().min(3).max(20),
  visualPurpose: VisualPurposeSchema.optional(),
  cinematicPrompt: z.string().optional(),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const CaptionStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  color: z.string(),
  highlightColor: z.string(),
  animation: CaptionAnimationSchema,
  position: z.enum(["bottom", "center", "top"]),
  maxWordsPerGroup: z.number().min(1).max(8),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const ColorStrategySchema = z.object({
  palette: z.array(z.string()).min(2).max(6),
  overlayOpacity: z.number().min(0).max(0.8),
  vignetteStrength: z.number().min(0).max(1),
  tint: z.string().nullable(),
});
export type ColorStrategy = z.infer<typeof ColorStrategySchema>;

export const VisualMixRulesSchema = z.object({
  maxConsecutiveSameMode: z.number().min(1),
  requiredModeVariation: z.number().min(2),
  preferredModes: z.array(VisualModeSchema),
});
export type VisualMixRules = z.infer<typeof VisualMixRulesSchema>;

export const PacingRulesSchema = z.object({
  defaultPaddingMs: z.number(),
  audioPaddingMs: z.number(),
  minSceneDurationMs: z.number(),
  maxSceneDurationMs: z.number(),
});
export type PacingRules = z.infer<typeof PacingRulesSchema>;

export const StyleProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  tone: z.string(),
  captionStyle: CaptionStyleSchema,
  motionStyle: MotionStyleSchema,
  transitionStyle: TransitionStyleSchema,
  colorStrategy: ColorStrategySchema,
  narrationStyle: NarrationStyleSchema,
  visualMixRules: VisualMixRulesSchema,
  pacingRules: PacingRulesSchema,
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;

export const VisualAssetSchema = z.object({
  type: VisualModeSchema,
  provider: z.enum(["pexels", "pixabay", "generated"]),
  url: z.string().nullable(),
  svgData: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  metadata: z.object({
    width: z.number(),
    height: z.number(),
    durationSeconds: z.number().nullable(),
    attribution: z.string().nullable(),
    sceneHash: z.string(),
  }),
});
export type VisualAsset = z.infer<typeof VisualAssetSchema>;

export const AudioResultSchema = z.object({
  path: z.string(),
  durationMs: z.number().nonnegative(),
  provider: z.enum(["kokoro", "piper", "silent"]),
  wordTimings: z.array(WordTimingSchema).nullable(),
});
export type AudioResult = z.infer<typeof AudioResultSchema>;

export const CaptionEntrySchema = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  emphasisWords: z.array(z.string()),
  style: z.enum(["normal", "emphasis", "whisper"]),
});
export type CaptionEntry = z.infer<typeof CaptionEntrySchema>;

export const RenderJobSchema = z.object({
  jobId: z.string(),
  scenes: z.array(ScenePlanSchema),
  resolvedAssets: z.array(VisualAssetSchema),
  audioResults: z.array(AudioResultSchema),
  styleProfile: StyleProfileSchema,
  audioEnabled: z.boolean(),
  outputPath: z.string(),
  srtPath: z.string(),
  status: z.enum(["pending", "bundling", "rendering", "done", "error"]),
  progressPercent: z.number().min(0).max(100),
  errorMessage: z.string().nullable(),
  createdAt: z.number(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

// ─── Remotion Composition Props ───────────────────────────────────────────────

export const SceneWithTimingSchema = ScenePlanSchema.extend({
  startFrame: z.number(),
  durationFrames: z.number(),
});
export type SceneWithTiming = z.infer<typeof SceneWithTimingSchema>;

export const ShortFormVideoPropsSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  scenesWithTiming: z.array(SceneWithTimingSchema),
  resolvedAssets: z.array(VisualAssetSchema),
  audioResults: z.array(AudioResultSchema),
  captionEntries: z.array(CaptionEntrySchema),
  styleProfile: StyleProfileSchema,
  audioEnabled: z.boolean(),
  totalFrames: z.number(),
});
export type ShortFormVideoProps = z.infer<typeof ShortFormVideoPropsSchema>;

// ─── Provider Option Types ─────────────────────────────────────────────────────

export const PlannerOptionsSchema = z.object({
  style: StyleProfileSchema,
  targetDurationSeconds: z.number().min(30).max(120).default(67),
  minScenes: z.number().min(2).max(4).default(4),
  maxScenes: z.number().min(4).max(12).default(8),
});
export type PlannerOptions = z.infer<typeof PlannerOptionsSchema>;

export const VoiceOptionsSchema = z.object({
  voiceId: z.string().default("af_sky"),
  speed: z.number().min(0.5).max(2.0).default(1.0),
  pitch: z.number().optional(),
});
export type VoiceOptions = z.infer<typeof VoiceOptionsSchema>;

// ─── API Contract Schemas ─────────────────────────────────────────────────────

export const PlanRequestSchema = z.object({
  script: z.string().min(50).max(5000),
  styleId: z.string(),
  options: z
    .object({
      targetDurationSeconds: z.number().optional(),
      minScenes: z.number().optional(),
      maxScenes: z.number().optional(),
    })
    .optional(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResponseSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  warnings: z.array(z.string()),
  provider: z.enum(["ollama", "openrouter", "deterministic", "cached"]),
  cached: z.boolean(),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const ResolveVisualsRequestSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  styleId: z.string(),
});
export type ResolveVisualsRequest = z.infer<typeof ResolveVisualsRequestSchema>;

export const ResolveVisualsResponseSchema = z.object({
  assets: z.array(VisualAssetSchema),
  providers: z.array(z.string()),
});
export type ResolveVisualsResponse = z.infer<typeof ResolveVisualsResponseSchema>;

export const SynthesizeRequestSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  voiceId: z.string().optional(),
  speed: z.number().optional(),
});
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;

export const SynthesizeResponseSchema = z.object({
  audioResults: z.array(
    AudioResultSchema.omit({ path: true }).extend({
      durationMs: z.number(),
      provider: z.enum(["kokoro", "piper", "silent"]),
      wordTimings: z.array(WordTimingSchema).nullable(),
    })
  ),
  provider: z.enum(["kokoro", "piper", "silent"]),
  totalDurationMs: z.number(),
});
export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>;

export const RenderRequestSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  resolvedAssets: z.array(VisualAssetSchema),
  audioResults: z.array(
    z.object({
      durationMs: z.number(),
      provider: z.enum(["kokoro", "piper", "silent"]),
      wordTimings: z.array(WordTimingSchema).nullable(),
    })
  ),
  styleId: z.string(),
  audioEnabled: z.boolean(),
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export const RenderResponseSchema = z.object({
  jobId: z.string(),
});
export type RenderResponse = z.infer<typeof RenderResponseSchema>;

export const RenderStatusSchema = z.object({
  status: z.enum(["pending", "bundling", "rendering", "done", "error"]),
  progressPercent: z.number(),
  errorMessage: z.string().nullable(),
});
export type RenderStatus = z.infer<typeof RenderStatusSchema>;
