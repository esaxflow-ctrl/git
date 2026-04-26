import { useState } from "react";
import { api, ScriptGenerationResult } from "../api/client";

interface Props {
  onScriptReady: (script: string) => void;
}

const TONES = [
  "sharp, moody, direct",
  "calm, intense, conversational",
  "playful, fast, sharp",
  "warm, honest, grounded",
  "urgent, conspiratorial",
  "deadpan, observational",
];

const NICHES = [
  "psychology / self-improvement",
  "history",
  "science / nature",
  "tech / AI",
  "finance / markets",
  "fitness / health",
  "creator / craft",
  "internet mystery / true story",
];

const CTA_STYLES = ["subtle", "direct", "none"];

export function ScriptGeneratorPanel({ onScriptReady }: Props) {
  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState(NICHES[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [targetViewer, setTargetViewer] = useState("");
  const [voiceStyle, setVoiceStyle] = useState("realistic young male, calm but intense");
  const [ctaStyle, setCtaStyle] = useState("subtle");
  const [bannedPhrases, setBannedPhrases] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptGenerationResult | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const banned = bannedPhrases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      const res = await api.script.generate({
        topic,
        niche,
        tone,
        targetViewer: targetViewer || undefined,
        voiceStyle,
        ctaStyle,
        bannedPhrases: banned.length ? banned : undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const canGenerate = topic.trim().length >= 3 && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db" }}>
        Or generate a 60-second script
      </div>

      <textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic (e.g. procrastinating simple tasks because they feel emotionally annoying)"
        style={{
          width: "100%",
          minHeight: 70,
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 8,
          padding: 12,
          color: "#f0f0f0",
          fontSize: 13,
          lineHeight: 1.5,
          resize: "vertical",
          outline: "none",
          fontFamily: "inherit",
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Select label="Niche" value={niche} options={NICHES} onChange={setNiche} />
        <Select label="Tone" value={tone} options={TONES} onChange={setTone} />
      </div>

      <input
        value={targetViewer}
        onChange={(e) => setTargetViewer(e.target.value)}
        placeholder="Target viewer (e.g. late teens / 20s who avoid basic tasks)"
        style={inputStyle}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          value={voiceStyle}
          onChange={(e) => setVoiceStyle(e.target.value)}
          placeholder="Voice style"
          style={inputStyle}
        />
        <Select label="CTA" value={ctaStyle} options={CTA_STYLES} onChange={setCtaStyle} />
      </div>

      <input
        value={bannedPhrases}
        onChange={(e) => setBannedPhrases(e.target.value)}
        placeholder="Banned phrases (comma-separated, optional)"
        style={inputStyle}
      />

      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        style={{
          padding: "10px 16px",
          background: canGenerate ? "#10b981" : "#1f2937",
          color: canGenerate ? "#fff" : "#4b5563",
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: canGenerate ? "pointer" : "not-allowed",
        }}
      >
        {loading ? "Writing…" : "Write Script"}
      </button>

      {error && (
        <div
          style={{
            background: "#1c0000",
            border: "1px solid #7f1d1d",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "#fca5a5",
          }}
        >
          ✗ {error}
        </div>
      )}

      {result && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "#0d1117",
            border: "1px solid #1f2937",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Provider: {result.provider} · {result.generated.wordCount} words ·
            ~{result.validation.estimatedSeconds}s · hook ~{result.validation.hookSeconds}s
            {!result.validation.valid && " · ⚠ has errors"}
          </div>

          {result.validation.issues.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {result.validation.issues.map((issue, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: issue.level === "error" ? "#fca5a5" : "#fbbf24",
                  }}
                >
                  {issue.level === "error" ? "✗" : "⚠"} {issue.message}
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              fontSize: 13,
              color: "#e5e7eb",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              padding: 10,
              background: "#0a0a0a",
              borderRadius: 6,
              border: "1px solid #1f2937",
            }}
          >
            {result.generated.script}
          </div>

          {result.generated.alternateHooks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, color: "#6b7280" }}>Alternate hooks:</div>
              {result.generated.alternateHooks.map((h, i) => (
                <div key={i} style={{ fontSize: 12, color: "#9ca3af" }}>
                  · {h}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => onScriptReady(result.generated.script)}
            style={{
              padding: "8px 14px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
          >
            Use this script →
          </button>
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      style={inputStyle}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {label}: {opt}
        </option>
      ))}
    </select>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#111827",
  border: "1px solid #1f2937",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#f0f0f0",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};
