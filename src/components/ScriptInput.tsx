import { useState, useEffect } from "react";
import { StyleProfile } from "../lib/validation/schemas";
import { api } from "../api/client";

interface Props {
  onGenerate: (script: string, styleId: string) => void;
  loading: boolean;
  initialScript?: string;
}

const SAMPLE_SCRIPT = `In 1969, NASA landed humans on the moon using computers less powerful than a modern calculator.

The Apollo Guidance Computer had just 4 kilobytes of RAM and ran at 0.043 MHz. Your smartphone is literally a million times more powerful.

But here's the thing nobody talks about: it wasn't the hardware that got them there. It was the software — 145,000 lines of hand-coded assembly, written mostly by women.

Margaret Hamilton, the lead developer, coined the term "software engineering" to give her team's work the respect it deserved. Before that, people called it "coding," as if it were just typing.

The code was so reliable it had zero crashes during the entire mission. Zero. That's a standard we still haven't matched today.`;

export function ScriptInput({ onGenerate, loading, initialScript }: Props) {
  const [script, setScript] = useState("");
  const [styleId, setStyleId] = useState("dark_cinematic");
  const [styles, setStyles] = useState<StyleProfile[]>([]);

  useEffect(() => {
    api.styles.list().then(setStyles).catch(console.error);
  }, []);

  useEffect(() => {
    if (initialScript && initialScript !== script) {
      setScript(initialScript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScript]);

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const canGenerate = script.trim().length >= 50 && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: "#d1d5db" }}>
          Script
        </label>
        <button
          onClick={() => setScript(SAMPLE_SCRIPT)}
          style={{
            fontSize: 12,
            color: "#6b7280",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          Load sample
        </button>
      </div>

      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        placeholder="Paste your script here… (50 min, up to 5000 · aim for ~800 chars / 150 words for a 60-second video)"
        style={{
          width: "100%",
          minHeight: 200,
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 8,
          padding: 16,
          color: "#f0f0f0",
          fontSize: 14,
          lineHeight: 1.6,
          resize: "vertical",
          outline: "none",
          fontFamily: "inherit",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <select
          value={styleId}
          onChange={(e) => setStyleId(e.target.value)}
          style={{
            flex: 1,
            background: "#111827",
            border: "1px solid #1f2937",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#f0f0f0",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.tone}
            </option>
          ))}
        </select>

        <button
          onClick={() => onGenerate(script, styleId)}
          disabled={!canGenerate}
          style={{
            padding: "10px 24px",
            background: canGenerate ? "#3b82f6" : "#1f2937",
            color: canGenerate ? "#fff" : "#4b5563",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: canGenerate ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "Planning…" : "Generate Plan"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#4b5563" }}>
        {script.length} chars · {wordCount} words · ~{Math.round((wordCount / 150) * 60)}s estimated
        {wordCount > 0 && wordCount < 80 && " · (add more for a 60s video)"}
        {wordCount >= 80 && wordCount <= 180 && " · ✓ good length"}
      </div>
    </div>
  );
}
