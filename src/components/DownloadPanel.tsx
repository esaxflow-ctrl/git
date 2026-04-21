import { api } from "../api/client";

interface Props {
  jobId: string;
}

export function DownloadPanel({ jobId }: Props) {
  return (
    <div
      style={{
        background: "#052e16",
        border: "1px solid #14532d",
        borderRadius: 10,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "#4ade80" }}>
        ✓ Render Complete
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <a
          href={api.render.downloadUrl(jobId)}
          download
          style={{
            flex: 1,
            padding: "10px 16px",
            background: "#166534",
            border: "1px solid #16a34a",
            borderRadius: 8,
            color: "#f0fdf4",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          ↓ Download MP4
        </a>

        <a
          href={api.render.srtUrl(jobId)}
          download
          style={{
            padding: "10px 16px",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#9ca3af",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          ↓ SRT
        </a>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280" }}>
        1080×1920 · 30fps · H.264 MP4
      </div>
    </div>
  );
}
