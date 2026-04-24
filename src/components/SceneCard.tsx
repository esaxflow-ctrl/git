import { useState } from "react";
import { ScenePlan, VisualMode, PacingMode, VisualAsset } from "../lib/validation/schemas";
import { scoreSearchTerms } from "../lib/validation/antiGeneric";

const VISUAL_MODES: VisualMode[] = [
  "stockVideo", "stockImage", "gradientMotionCard", "textCard",
  "quoteCard", "evidenceCard", "mapCard", "timelineCard",
];

const PACING_MODES: PacingMode[] = ["fast", "medium", "slow", "dramatic_pause"];

const MODE_ICONS: Record<VisualMode, string> = {
  stockVideo: "▶",
  stockImage: "🖼",
  gradientMotionCard: "◈",
  textCard: "T",
  quoteCard: '"',
  evidenceCard: "⊞",
  mapCard: "◎",
  timelineCard: "⧖",
};

function DebugPanel({ scene, resolvedAsset }: { scene: ScenePlan; resolvedAsset?: VisualAsset }) {
  const { avgScore, scores, weak } = scoreSearchTerms(scene.searchTerms);
  const panelStyle: React.CSSProperties = {
    background: "#060a12",
    border: "1px solid #111827",
    borderRadius: 8,
    padding: "12px 14px",
    fontSize: 11,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    color: "#6b7280",
  };
  const rowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
  return (
    <div style={panelStyle}>
      <div style={{ color: "#374151", fontWeight: 700, fontSize: 12 }}>Debug telemetry</div>

      {/* Visual selection reasoning */}
      {scene.visualPurpose && (
        <div>
          <span style={{ color: "#4b5563" }}>Purpose: </span>
          <span style={{ color: "#9ca3af" }}>{scene.visualPurpose.replace(/_/g, " ")}</span>
        </div>
      )}
      {scene.sceneGoal && (
        <div>
          <span style={{ color: "#4b5563" }}>Goal: </span>
          <span style={{ color: "#9ca3af", fontStyle: "italic" }}>{scene.sceneGoal}</span>
        </div>
      )}
      {scene.cinematicPrompt && (
        <div>
          <span style={{ color: "#4b5563" }}>Cinematic prompt: </span>
          <span style={{ color: "#9ca3af" }}>{scene.cinematicPrompt}</span>
        </div>
      )}

      {/* Search term scores */}
      <div>
        <div style={{ color: "#4b5563", marginBottom: 4 }}>
          Search terms (avg score {avgScore.toFixed(1)}/10
          {weak.length > 0 && <span style={{ color: "#f97316" }}> — {weak.length} weak</span>}
          ):
        </div>
        <div style={rowStyle}>
          {scores.map((s) => (
            <span
              key={s.term}
              title={s.reason}
            style={{
                background: s.score <= 2 ? "#1c0800" : s.score >= 6 ? "#071f0a" : "#0a0f1a",
                border: `1px solid ${s.score <= 2 ? "#92400e" : s.score >= 6 ? "#14532d" : "#1f2937"}`,
                borderRadius: 4,
                padding: "2px 7px",
                color: s.score <= 2 ? "#f97316" : s.score >= 6 ? "#4ade80" : "#9ca3af",
              }}
            >
              {s.term} <span style={{ opacity: 0.5 }}>{s.score}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Resolved asset info + telemetry */}
      {resolvedAsset && (
        <div>
          <div style={{ color: "#4b5563", marginBottom: 4 }}>Resolved asset:</div>
          <div style={rowStyle}>
            <span style={{ color: "#9ca3af" }}>provider: <b>{resolvedAsset.provider}</b></span>
            <span style={{ color: "#9ca3af" }}>type: <b>{resolvedAsset.type}</b></span>
            {resolvedAsset.metadata.width > 0 && (
              <span style={{ color: "#9ca3af" }}>
                {resolvedAsset.metadata.width}×{resolvedAsset.metadata.height}
              </span>
            )}
          </div>
          {resolvedAsset.metadata.attribution && (
            <div style={{ color: "#374151", marginTop: 4, fontStyle: "italic" }}>
              {resolvedAsset.metadata.attribution}
            </div>
          )}
          {resolvedAsset.url && (
            <div style={{ marginTop: 4, color: "#1d4ed8", wordBreak: "break-all", fontSize: 10 }}>
              {resolvedAsset.url.slice(0, 80)}{resolvedAsset.url.length > 80 ? "…" : ""}
            </div>
          )}

          {/* Debug telemetry from provider */}
          {resolvedAsset.metadata.debug && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ color: "#4b5563", fontSize: 11 }}>
                Queries tried ({resolvedAsset.metadata.debug.candidateCount} candidates, top score {resolvedAsset.metadata.debug.topScore}):
              </div>
              <div style={rowStyle}>
                {resolvedAsset.metadata.debug.candidateQueries.map((q, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#0a0f1a",
                      border: "1px solid #1f2937",
                      borderRadius: 4,
                      padding: "2px 7px",
                      color: "#6b7280",
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                  >
                    {q.length > 40 ? q.slice(0, 40) + "…" : q}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#374151" }}>
                Ranking: {resolvedAsset.metadata.debug.rankingReason}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PACING_COLORS: Record<PacingMode, string> = {
  fast: "#ef4444",
  medium: "#f59e0b",
  slow: "#3b82f6",
  dramatic_pause: "#8b5cf6",
};

interface Props {
  scene: ScenePlan;
  index: number;
  onChange: (updated: ScenePlan) => void;
  resolvedAsset?: VisualAsset;
}

export function SceneCard({ scene, index, onChange, resolvedAsset }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  function update(partial: Partial<ScenePlan>) {
    onChange({ ...scene, ...partial });
  }

  const inputStyle: React.CSSProperties = {
    background: "#0a0f1a",
    border: "1px solid #1f2937",
    borderRadius: 6,
    padding: "6px 10px",
    color: "#f0f0f0",
    fontSize: 13,
    width: "100%",
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid #1f2937",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: "#4b5563", fontSize: 12, fontWeight: 600, minWidth: 24 }}>
          {index + 1}
        </span>
        <span
          style={{
            fontSize: 14,
            color: "#9ca3af",
            background: "#1f2937",
            borderRadius: 4,
            padding: "2px 8px",
          }}
        >
          {MODE_ICONS[scene.visualMode]} {scene.visualMode}
        </span>
        <span
          style={{
            fontSize: 11,
            color: PACING_COLORS[scene.pacing],
            background: "#1f2937",
            borderRadius: 4,
            padding: "2px 6px",
            fontWeight: 600,
          }}
        >
          {scene.pacing}
        </span>
        <span style={{ flex: 1, fontSize: 13, color: "#d1d5db", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {scene.caption}
        </span>
        <span style={{ color: "#4b5563", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded fields */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <hr style={{ border: "none", borderTop: "1px solid #1f2937", margin: "0 0 4px" }} />

          <label style={{ fontSize: 12, color: "#6b7280" }}>
            Caption
            <input
              style={{ ...inputStyle, marginTop: 4, display: "block" }}
              value={scene.caption}
              onChange={(e) => update({ caption: e.target.value })}
            />
          </label>

          <label style={{ fontSize: 12, color: "#6b7280" }}>
            Narration
            <textarea
              style={{ ...inputStyle, marginTop: 4, display: "block", minHeight: 80, resize: "vertical" }}
              value={scene.narration}
              onChange={(e) => update({ narration: e.target.value })}
            />
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>
              Visual Mode
              <select
                style={{ ...inputStyle, marginTop: 4, display: "block" }}
                value={scene.visualMode}
                onChange={(e) => update({ visualMode: e.target.value as VisualMode })}
              >
                {VISUAL_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>
              Pacing
              <select
                style={{ ...inputStyle, marginTop: 4, display: "block" }}
                value={scene.pacing}
                onChange={(e) => update({ pacing: e.target.value as PacingMode })}
              >
                {PACING_MODES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ fontSize: 12, color: "#6b7280" }}>
            Search Terms (comma-separated)
            <input
              style={{ ...inputStyle, marginTop: 4, display: "block" }}
              value={scene.searchTerms.join(", ")}
              onChange={(e) =>
                update({
                  searchTerms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
            />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Role: <span style={{ color: "#6b7280" }}>{scene.visualRole}</span>
            </div>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Mood: <span style={{ color: "#6b7280" }}>{scene.mood}</span>
            </div>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              ~{scene.durationHint}s
            </div>
            <button
              onClick={() => setShowDebug(!showDebug)}
              style={{
                fontSize: 11,
                color: showDebug ? "#60a5fa" : "#374151",
                background: "none",
                border: "1px solid " + (showDebug ? "#1d4ed8" : "#1f2937"),
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              {showDebug ? "hide debug" : "why this visual?"}
            </button>
          </div>

          {showDebug && <DebugPanel scene={scene} resolvedAsset={resolvedAsset} />}
        </div>
      )}
    </div>
  );
}
