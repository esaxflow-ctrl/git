import { QualityReport } from "../api/client";

interface Props {
  report: QualityReport | null;
  loading: boolean;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#4ade80",
  B: "#86efac",
  C: "#fbbf24",
  D: "#f97316",
  F: "#ef4444",
};

const DIM_LABELS: Record<string, string> = {
  hookStrength: "Hook Strength",
  scriptOriginality: "Script Originality",
  visualSpecificity: "Visual Specificity",
  captionReadability: "Caption Readability",
  voiceoverPacing: "Voiceover Pacing",
  sceneVariety: "Scene Variety",
  retentionPotential: "Retention Potential",
};

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? "#4ade80" : score >= 60 ? "#fbbf24" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "#6b7280", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "#1f2937", borderRadius: 2 }}>
        <div
          style={{
            height: "100%",
            width: `${score}%`,
            background: color,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 28, textAlign: "right", fontWeight: 600 }}>
        {score}
      </span>
    </div>
  );
}

export function QualityGatePanel({ report, loading }: Props) {
  if (loading) {
    return (
      <div style={{ fontSize: 12, color: "#4b5563", padding: "8px 0" }}>
        Analyzing quality…
      </div>
    );
  }

  if (!report) return null;

  const gradeColor = GRADE_COLORS[report.grade] ?? "#9ca3af";

  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #1f2937",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#d1d5db" }}>Quality Analysis</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {report.overallScoreOutOf10}/10 · {report.overallScore}/100
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 900,
              color: gradeColor,
              background: `${gradeColor}22`,
              borderRadius: 6,
              padding: "2px 10px",
              border: `1px solid ${gradeColor}44`,
            }}
          >
            {report.grade}
          </span>
        </div>
      </div>

      {/* Revisions needed (under-8/10 dimensions) */}
      {report.revisionsNeeded.length > 0 && report.overallScoreOutOf10 < 8 && (
        <div
          style={{
            fontSize: 11,
            color: "#fbbf24",
            background: "#1f1500",
            border: "1px solid #7c5e00",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          Below 8/10 — revise: {report.revisionsNeeded.join(", ")}
        </div>
      )}

      {/* Dimension scores */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {Object.entries(report.dimensions).map(([key, score]) => (
          <ScoreBar key={key} label={DIM_LABELS[key] ?? key} score={score} />
        ))}
      </div>

      {/* Blockers */}
      {report.blockers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {report.blockers.map((b, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                color: "#fca5a5",
                background: "#1c0000",
                border: "1px solid #7f1d1d",
                borderRadius: 6,
                padding: "5px 10px",
              }}
            >
              ✗ {b}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {report.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#fbbf24" }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
