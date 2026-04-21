import { RenderStatus } from "../lib/validation/schemas";
import { ProviderStatus } from "./ProviderStatus";

type WorkflowStep = "idle" | "resolving" | "synthesizing" | "rendering" | "done" | "error";

interface Props {
  step: WorkflowStep;
  renderStatus: RenderStatus | null;
  audioEnabled: boolean;
  providerInfo: {
    planner?: string;
    visuals?: string[];
    tts?: string;
  };
  onToggleAudio: () => void;
  onResolveVisuals: () => void;
  onSynthesize: () => void;
  onRender: () => void;
  error: string | null;
  visualsResolved: boolean;
  audioSynthesized: boolean;
}

function StepButton({
  label,
  onClick,
  disabled,
  active,
  done,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  done: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 18px",
        background: done ? "#14532d" : active ? "#1e40af" : disabled ? "#1f2937" : "#1f2937",
        border: done
          ? "1px solid #16a34a"
          : active
          ? "1px solid #3b82f6"
          : "1px solid #374151",
        borderRadius: 8,
        color: done ? "#4ade80" : active ? "#fff" : disabled ? "#4b5563" : "#9ca3af",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {done ? `✓ ${label}` : label}
    </button>
  );
}

export function RenderControls({
  step,
  renderStatus,
  audioEnabled,
  providerInfo,
  onToggleAudio,
  onResolveVisuals,
  onSynthesize,
  onRender,
  error,
  visualsResolved,
  audioSynthesized,
}: Props) {
  const progressPct = renderStatus?.progressPercent ?? 0;
  const isRendering = step === "rendering";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db" }}>Render Pipeline</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {/* Step 1: Resolve Visuals */}
        <StepButton
          label="1. Resolve Visuals"
          onClick={onResolveVisuals}
          disabled={step !== "idle" && !visualsResolved}
          active={step === "resolving"}
          done={visualsResolved}
        />

        {/* Step 2: Audio toggle + synthesize */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#6b7280",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={audioEnabled}
              onChange={onToggleAudio}
              disabled={step === "rendering"}
            />
            Audio
          </label>
          <StepButton
            label="2. Synthesize"
            onClick={onSynthesize}
            disabled={!visualsResolved || step === "rendering" || !audioEnabled}
            active={step === "synthesizing"}
            done={audioSynthesized}
          />
        </div>

        {/* Step 3: Render */}
        <StepButton
          label="3. Render MP4"
          onClick={onRender}
          disabled={!visualsResolved || step === "rendering" || step === "done"}
          active={isRendering}
          done={step === "done"}
        />
      </div>

      {/* Progress bar */}
      {(isRendering || step === "done") && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {renderStatus?.status === "bundling"
                ? "Bundling compositions…"
                : renderStatus?.status === "rendering"
                ? `Rendering frames… ${progressPct}%`
                : step === "done"
                ? "Complete"
                : ""}
            </span>
            <span style={{ fontSize: 12, color: "#4b5563" }}>{progressPct}%</span>
          </div>
          <div style={{ height: 4, background: "#1f2937", borderRadius: 2 }}>
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: step === "done" ? "#16a34a" : "#3b82f6",
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
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
          ✗ {error}
        </div>
      )}

      {/* Provider status */}
      <ProviderStatus info={providerInfo} />
    </div>
  );
}
