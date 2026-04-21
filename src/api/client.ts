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
} from "../lib/validation/schemas";
import { z } from "zod";

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
};
