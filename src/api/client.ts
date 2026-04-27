import {
  PlanRequest,
  PlanResponse,
  PlanResponseSchema,
  ResolveVisualsRequest,
  ResolveVisualsResponse,
  ResolveVisualsResponseSchema,
  SynthesizeRequest,
  SynthesizeResponse,
  SynthesizeResponseSchema,
  RenderRequest,
  RenderResponse,
  RenderResponseSchema,
  RenderStatus,
  RenderStatusSchema,
  StyleProfile,
  StyleProfileSchema,
  ScenePlan,
  VisualAsset,
  AudioResult,
} from "../lib/validation/schemas";
import { z } from "zod";

const QualityReportSchema = z.object({
  overallScore: z.number(),
  overallScoreOutOf10: z.number(),
  dimensions: z.object({
    hookStrength: z.number(),
    scriptOriginality: z.number(),
    visualSpecificity: z.number(),
    captionReadability: z.number(),
    voiceoverPacing: z.number(),
    sceneVariety: z.number(),
    retentionPotential: z.number(),
  }),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  revisionsNeeded: z.array(z.string()),
  grade: z.enum(["A", "B", "C", "D", "F"]),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = ((import.meta as any).env?.VITE_API_BASE as string | undefined) ?? "/api";

async function post<T>(url: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  }

  return schema.parse(data);
}

async function get<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return schema.parse(data);
}

export const api = {
  styles: {
    list: () => get("/styles", z.array(StyleProfileSchema)),
  },

  plan: {
    generate: (body: PlanRequest) =>
      post<PlanResponse>("/plan", body, PlanResponseSchema),
  },

  visuals: {
    resolve: (body: ResolveVisualsRequest) =>
      post<ResolveVisualsResponse>("/resolve-visuals", body, ResolveVisualsResponseSchema),
  },

  tts: {
    synthesize: (body: SynthesizeRequest) =>
      post<SynthesizeResponse>("/synthesize", body, SynthesizeResponseSchema),
  },

  render: {
    start: (body: RenderRequest) =>
      post<RenderResponse>("/render", body, RenderResponseSchema),

    status: (
      jobId: string,
      onUpdate: (status: RenderStatus) => void,
      onDone: () => void,
      onError: (msg: string) => void
    ): (() => void) => {
      const es = new EventSource(`${BASE}/render/${jobId}/status`);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        const parsed = RenderStatusSchema.safeParse(data);
        if (!parsed.success) return;

        onUpdate(parsed.data);

        if (parsed.data.status === "done") {
          es.close();
          onDone();
        } else if (parsed.data.status === "error") {
          es.close();
          onError(parsed.data.errorMessage ?? "Render failed");
        }
      };

      es.onerror = () => {
        es.close();
        onError("Connection to render stream lost");
      };

      return () => es.close();
    },

    downloadUrl: (jobId: string) => `${BASE}/download/${jobId}`,
    srtUrl: (jobId: string) => `${BASE}/download/${jobId}/srt`,
  },

  analyze: {
    quality: (body: {
      scenes: ScenePlan[];
      resolvedAssets?: VisualAsset[];
      audioResults?: Partial<AudioResult>[];
    }) => post<QualityReport>("/analyze", body, QualityReportSchema),
  },

  script: {
    generate: (body: ScriptGenerateRequest) =>
      post<ScriptGenerationResult>("/script/generate", body, ScriptGenerationResultSchema),
    validate: (body: { script: string }) =>
      post<ScriptValidationResult>("/script/validate", body, ScriptValidationResultSchema),
  },

  report: {
    get: (jobId: string) => get(`/render/${jobId}/report`, DebugReportSchema),
  },
};

// ─── Script generator types ──────────────────────────────────────────────────

const ScriptGenerateRequestSchema = z.object({
  topic: z.string().min(3).max(500),
  niche: z.string().max(80).optional(),
  tone: z.string().max(120).optional(),
  targetViewer: z.string().max(160).optional(),
  visualStyle: z.string().max(160).optional(),
  voiceStyle: z.string().max(120).optional(),
  ctaStyle: z.string().max(60).optional(),
  platform: z.string().max(60).optional(),
  referenceStyle: z.string().max(160).optional(),
  bannedPhrases: z.array(z.string().max(60)).max(20).optional(),
});
export type ScriptGenerateRequest = z.infer<typeof ScriptGenerateRequestSchema>;

const ScriptValidationResultSchema = z.object({
  valid: z.boolean(),
  wordCount: z.number(),
  estimatedSeconds: z.number(),
  hookWordCount: z.number(),
  hookSeconds: z.number(),
  issues: z.array(
    z.object({
      level: z.enum(["error", "warning"]),
      code: z.string(),
      message: z.string(),
    })
  ),
});
export type ScriptValidationResult = z.infer<typeof ScriptValidationResultSchema>;

const ScriptGenerationResultSchema = z.object({
  generated: z.object({
    script: z.string(),
    alternateHooks: z.array(z.string()),
    structure: z.object({
      hook: z.string(),
      setup: z.string(),
      points: z.array(z.string()),
      payoff: z.string(),
      cta: z.string(),
    }),
    scenePrompts: z.array(
      z.object({
        narration: z.string(),
        visualPrompt: z.string(),
        backgroundType: z.string(),
        estimatedSeconds: z.number(),
      })
    ),
    captionLines: z.array(z.string()),
    wordCount: z.number(),
  }),
  provider: z.enum(["ollama", "openrouter", "deterministic"]),
  validation: ScriptValidationResultSchema,
});
export type ScriptGenerationResult = z.infer<typeof ScriptGenerationResultSchema>;

const DebugReportSchema = z.object({
  jobId: z.string(),
  createdAt: z.number(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  scriptWordCount: z.number(),
  voiceoverDurationMs: z.number(),
  finalVideoDurationSeconds: z.number().nullable(),
  sceneCount: z.number(),
  visualAssetsCount: z.number(),
  visualAssetsByProvider: z.record(z.number()),
  ttsProvidersUsed: z.array(z.string()),
  captionCount: z.number(),
  fallbacksUsed: z.array(z.string()),
  outputPath: z.string(),
  srtPath: z.string(),
  audioEnabled: z.boolean(),
  validation: z
    .object({
      pass: z.boolean(),
      fileExists: z.boolean(),
      fileSizeBytes: z.number(),
      durationSeconds: z.number().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      hasAudio: z.boolean(),
      expectedDurationSeconds: z.number(),
      failures: z.array(z.string()),
    })
    .nullable(),
  validationPass: z.boolean().nullable(),
  visualCoverage: z.object({
    totalScenes: z.number(),
    realPhotoScenes: z.number(),
    cardOrFallbackScenes: z.number(),
    generatedFallbackPercent: z.number(),
    textCardScenes: z.number(),
    textCardPercent: z.number(),
    textHeavy: z.boolean(),
    warnings: z.array(z.string()),
  }),
});
export type DebugReport = z.infer<typeof DebugReportSchema>;
