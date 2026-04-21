import { useState } from "react";
import { ScenePlan, VisualMode, PacingMode } from "../lib/validation/schemas";

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
}

export function SceneCard({ scene, index, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

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

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Role: <span style={{ color: "#6b7280" }}>{scene.visualRole}</span>
            </div>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              Mood: <span style={{ color: "#6b7280" }}>{scene.mood}</span>
            </div>
            <div style={{ fontSize: 12, color: "#4b5563" }}>
              ~{scene.durationHint}s
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
