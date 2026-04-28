import { useState, useCallback, useRef, useEffect } from "react";
import {
  ScenePlan,
  VisualAsset,
  AudioResult,
  RenderStatus,
} from "./lib/validation/schemas";
import { api, QualityReport } from "./api/client";
import { ScriptInput } from "./components/ScriptInput";
import { ScriptGeneratorPanel } from "./components/ScriptGeneratorPanel";
import { ScenePlanEditor } from "./components/ScenePlanEditor";
import { RenderControls } from "./components/RenderControls";
import { DownloadPanel } from "./components/DownloadPanel";
import { StoryboardPanel } from "./components/StoryboardPanel";
import { QualityGatePanel } from "./components/QualityGatePanel";

type AppStep = "idle" | "planning" | "editing" | "resolving" | "synthesizing" | "rendering" | "done" | "error";

interface State {
  step: AppStep;
  script: string;
  styleId: string;
  scenes: ScenePlan[];
  warnings: string[];
  planProvider: string;
  resolvedAssets: VisualAsset[];
  audioResults: AudioResult[];
  audioEnabled: boolean;
  visualsResolved: boolean;
  audioSynthesized: boolean;
  audioProvider: string;
  renderJobId: string | null;
  renderStatus: RenderStatus | null;
  error: string | null;
  providerInfo: { planner?: string; visuals?: string[]; tts?: string };
  qualityReport: QualityReport | null;
  qualityLoading: boolean;
}

const INITIAL: State = {
  step: "idle",
  script: "",
  styleId: "dark_cinematic",
  scenes: [],
  warnings: [],
  planProvider: "",
  resolvedAssets: [],
  audioResults: [],
  audioEnabled: false,
  visualsResolved: false,
  audioSynthesized: false,
  audioProvider: "",
  renderJobId: null,
  renderStatus: null,
  error: null,
  providerInfo: {},
  qualityReport: null,
  qualityLoading: false,
};

export default function App() {
  const [state, setState] = useState<State>(INITIAL);
  const [prefilledScript, setPrefilledScript] = useState<string>("");
  // Stash the per-beat visual hints from the script generator. When the user
  // sends an unedited template script through the planner, we pass these
  // hints so each scene's photo actually depicts the line being spoken.
  const [scenePromptsFromScript, setScenePromptsFromScript] = useState<
    Array<{ narration: string; visualPrompt: string }>
  >([]);
  const [scriptOriginal, setScriptOriginal] = useState<string>("");
  const sseCleanup = useRef<(() => void) | null>(null);

  function patch(partial: Partial<State>) {
    setState((s) => ({ ...s, ...partial }));
  }

  const handleGenerate = useCallback(
    async (script: string, styleId: string) => {
      patch({ step: "planning", script, styleId, error: null });
      try {
        // If the user hasn't edited the template-emitted script, ship the
        // curated per-beat visual hints to the planner. If they did edit,
        // those hints no longer match line-for-line so we drop them.
        const scriptUnchanged =
          scriptOriginal !== "" && scriptOriginal.trim() === script.trim();
        const prebuiltScenes = scriptUnchanged
          ? scenePromptsFromScript.map((p) => ({
              narration: p.narration,
              visualHint: p.visualPrompt,
            }))
          : undefined;

        const { scenes, warnings, provider } = await api.plan.generate({
          script,
          styleId,
          prebuiltScenes,
        });
        patch({
          step: "editing",
          scenes,
          warnings,
          planProvider: provider,
          providerInfo: { planner: provider },
          resolvedAssets: [],
          audioResults: [],
          visualsResolved: false,
          audioSynthesized: false,
          renderJobId: null,
          renderStatus: null,
        });
      } catch (err) {
        patch({ step: "idle", error: String(err) });
      }
    },
    [scriptOriginal, scenePromptsFromScript]
  );

  const handleRegenerate = useCallback(() => {
    if (!state.script || !state.styleId) return;
    handleGenerate(state.script, state.styleId);
  }, [state.script, state.styleId, handleGenerate]);

  const handleResolveVisuals = useCallback(async () => {
    patch({ step: "resolving", error: null });
    try {
      const { assets, providers } = await api.visuals.resolve({
        scenes: state.scenes,
        styleId: state.styleId,
      });
      patch({
        step: "editing",
        resolvedAssets: assets,
        visualsResolved: true,
        providerInfo: { ...state.providerInfo, visuals: providers },
      });
    } catch (err) {
      patch({ step: "editing", error: String(err) });
    }
  }, [state.scenes, state.styleId, state.providerInfo]);

  const handleSynthesize = useCallback(async () => {
    patch({ step: "synthesizing", error: null });
    try {
      const { audioResults, provider } = await api.tts.synthesize({
        scenes: state.scenes,
      });
      const results = audioResults.map((a) => ({ ...a, path: "" })) as AudioResult[];
      patch({
        step: "editing",
        audioResults: results,
        audioSynthesized: true,
        audioProvider: provider,
        providerInfo: { ...state.providerInfo, tts: provider },
      });
    } catch (err) {
      patch({ step: "editing", error: String(err) });
    }
  }, [state.scenes, state.providerInfo]);

  const handleRender = useCallback(async () => {
    patch({ step: "rendering", error: null, renderStatus: null });
    try {
      const { jobId } = await api.render.start({
        scenes: state.scenes,
        resolvedAssets: state.resolvedAssets,
        audioResults: state.audioResults.map(({ path: _p, ...rest }) => rest) as never,
        styleId: state.styleId,
        audioEnabled: state.audioEnabled,
      });

      patch({ renderJobId: jobId });

      sseCleanup.current = api.render.status(
        jobId,
        (status) => patch({ renderStatus: status }),
        () => patch({ step: "done" }),
        (msg) => patch({ step: "error", error: msg })
      );
    } catch (err) {
      patch({ step: "error", error: String(err) });
    }
  }, [state]);

  // Auto-run quality analysis whenever visuals or audio change
  useEffect(() => {
    if (!state.visualsResolved) return;
    patch({ qualityLoading: true });
    api.analyze
      .quality({
        scenes: state.scenes,
        resolvedAssets: state.resolvedAssets.length > 0 ? state.resolvedAssets : undefined,
        audioResults: state.audioSynthesized ? state.audioResults : undefined,
      })
      .then((report) => patch({ qualityReport: report, qualityLoading: false }))
      .catch(() => patch({ qualityLoading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.visualsResolved, state.audioSynthesized]);

  const isPlanning = state.step === "planning";
  const isEditing = ["editing", "resolving", "synthesizing"].includes(state.step);
  const showEditor = state.scenes.length > 0;
  const showDownload = state.step === "done" && state.renderJobId;

  const renderControlStep =
    state.step === "resolving"
      ? "resolving"
      : state.step === "synthesizing"
      ? "synthesizing"
      : state.step === "rendering"
      ? "rendering"
      : state.step === "done"
      ? "done"
      : "idle";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Header */}
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#f0f0f0",
              letterSpacing: -0.5,
              margin: 0,
            }}
          >
            Short-Form Video System
          </h1>
          <p style={{ fontSize: 13, color: "#4b5563", margin: "4px 0 0" }}>
            Script → 1080×1920 MP4 · Originality-first · No paid APIs required
          </p>
        </div>

        <Divider />

        {/* Script generator (LLM-driven 60s writer) */}
        <ScriptGeneratorPanel
          onScriptReady={(payload) => {
            setPrefilledScript(payload.script);
            setScriptOriginal(payload.script);
            setScenePromptsFromScript(payload.scenePrompts);
          }}
        />

        <Divider />

        {/* Script input — accepts a pasted or generated script */}
        <ScriptInput
          onGenerate={handleGenerate}
          loading={isPlanning}
          initialScript={prefilledScript}
        />

        {/* Error */}
        {state.error && !isEditing && (
          <ErrorBanner message={state.error} />
        )}

        {/* Scene plan editor */}
        {showEditor && (
          <>
            <Divider />
            <ScenePlanEditor
              scenes={state.scenes}
              warnings={state.warnings}
              provider={state.planProvider}
              resolvedAssets={state.resolvedAssets}
              onScenesChange={(scenes) => patch({ scenes })}
              onRegenerate={handleRegenerate}
              loading={isPlanning}
            />
          </>
        )}

        {/* Storyboard preview — shown once visuals are resolved */}
        {state.visualsResolved && state.resolvedAssets.length > 0 && (
          <>
            <Divider />
            <StoryboardPanel scenes={state.scenes} resolvedAssets={state.resolvedAssets} />
          </>
        )}

        {/* Quality gate — shown once visuals are resolved */}
        {state.visualsResolved && (
          <>
            <Divider />
            <QualityGatePanel report={state.qualityReport} loading={state.qualityLoading} />
          </>
        )}

        {/* Render controls */}
        {showEditor && (
          <>
            <Divider />
            <RenderControls
              step={renderControlStep}
              renderStatus={state.renderStatus}
              audioEnabled={state.audioEnabled}
              audioProvider={state.audioProvider}
              providerInfo={state.providerInfo}
              onToggleAudio={() => patch({ audioEnabled: !state.audioEnabled, audioSynthesized: false })}
              onResolveVisuals={handleResolveVisuals}
              onSynthesize={handleSynthesize}
              onRender={handleRender}
              error={state.error}
              visualsResolved={state.visualsResolved}
              audioSynthesized={state.audioSynthesized}
            />
          </>
        )}

        {/* Download */}
        {showDownload && (
          <>
            <Divider />
            <DownloadPanel jobId={state.renderJobId!} />
          </>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <hr style={{ border: "none", borderTop: "1px solid #1f2937", margin: 0 }} />;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: "#1c0000",
        border: "1px solid #7f1d1d",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        color: "#fca5a5",
      }}
    >
      ✗ {message}
    </div>
  );
}
