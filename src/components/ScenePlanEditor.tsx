import { ScenePlan, VisualAsset } from "../lib/validation/schemas";
import { SceneCard } from "./SceneCard";

interface Props {
  scenes: ScenePlan[];
  warnings: string[];
  provider: string;
  resolvedAssets?: VisualAsset[];
  onScenesChange: (scenes: ScenePlan[]) => void;
  onRegenerate: () => void;
  loading: boolean;
}

export function ScenePlanEditor({
  scenes,
  warnings,
  provider,
  resolvedAssets,
  onScenesChange,
  onRegenerate,
  loading,
}: Props) {
  function handleSceneChange(index: number, updated: ScenePlan) {
    const next = [...scenes];
    next[index] = updated;
    onScenesChange(next);
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (s.durationHint ?? 8), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db" }}>
            {scenes.length} Scenes
          </span>
          <span style={{ fontSize: 12, color: "#4b5563", marginLeft: 10 }}>
            ~{totalDuration}s · via {provider}
          </span>
        </div>
        <button
          onClick={onRegenerate}
          disabled={loading}
          style={{
            padding: "6px 14px",
            background: "none",
            border: "1px solid #374151",
            borderRadius: 6,
            color: loading ? "#4b5563" : "#9ca3af",
            fontSize: 12,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Regenerating…" : "↺ Regenerate"}
        </button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div
          style={{
            background: "#1c1200",
            border: "1px solid #451a03",
            borderRadius: 8,
            padding: "10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 2 }}>
            ⚠ Originality Warnings
          </div>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: "#d97706" }}>
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Scene cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={i}
            onChange={(updated) => handleSceneChange(i, updated)}
            resolvedAsset={resolvedAssets?.[i]}
          />
        ))}
      </div>
    </div>
  );
}
