interface ProviderInfo {
  planner?: string;
  visuals?: string[];
  tts?: string;
}

interface Props {
  info: ProviderInfo;
}

function Dot({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: active ? "#22c55e" : "#6b7280",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function Row({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#9ca3af" }}>
      <Dot active={good} />
      <span style={{ color: "#6b7280", minWidth: 80 }}>{label}:</span>
      <span style={{ color: good ? "#d1d5db" : "#6b7280" }}>{value}</span>
    </div>
  );
}

export function ProviderStatus({ info }: Props) {
  if (!info.planner && !info.tts && !info.visuals) return null;

  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid #1f2937",
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
        Providers
      </div>
      {info.planner && (
        <Row
          label="Planner"
          value={info.planner}
          good={info.planner !== "deterministic"}
        />
      )}
      {info.visuals && info.visuals.length > 0 && (
        <Row
          label="Visuals"
          value={[...new Set(info.visuals)].join(", ")}
          good={!info.visuals.every((v) => v === "generated")}
        />
      )}
      {info.tts && (
        <Row
          label="TTS"
          value={info.tts}
          good={info.tts !== "silent"}
        />
      )}
    </div>
  );
}
