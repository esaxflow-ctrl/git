import { ScenePlan, VisualAsset } from "../lib/validation/schemas";

interface Props {
  scenes: ScenePlan[];
  resolvedAssets: VisualAsset[];
}

const MODE_COLORS: Record<string, string> = {
  stockImage: "#3b82f6",
  stockVideo: "#8b5cf6",
  gradientMotionCard: "#f59e0b",
  textCard: "#6b7280",
  quoteCard: "#ec4899",
  evidenceCard: "#10b981",
  mapCard: "#06b6d4",
  timelineCard: "#f97316",
};

export function StoryboardPanel({ scenes, resolvedAssets }: Props) {
  if (resolvedAssets.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 12 }}>
        Storyboard Preview
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {scenes.map((scene, i) => {
          const asset = resolvedAssets[i];
          if (!asset) return null;

          const modeColor = MODE_COLORS[asset.type] ?? "#374151";
          const thumbUrl = asset.thumbnailUrl ?? asset.url;
          const isSvg = !thumbUrl && !!asset.svgData;

          return (
            <div
              key={scene.id}
              style={{
                flexShrink: 0,
                width: 90,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {/* Frame thumbnail */}
              <div
                style={{
                  width: 90,
                  height: 160,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: `2px solid ${modeColor}66`,
                  background: "#111827",
                  position: "relative",
                }}
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "center",
                    }}
                  />
                ) : isSvg ? (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: `linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 28,
                      color: modeColor,
                    }}
                  >
                    ◈
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      color: "#4b5563",
                    }}
                  >
                    No preview
                  </div>
                )}

                {/* Scene number badge */}
                <div
                  style={{
                    position: "absolute",
                    top: 5,
                    left: 5,
                    background: "rgba(0,0,0,0.75)",
                    borderRadius: 4,
                    padding: "2px 5px",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  {i + 1}
                </div>

                {/* Role badge */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 5,
                    right: 5,
                    background: `${modeColor}cc`,
                    borderRadius: 4,
                    padding: "2px 5px",
                    fontSize: 8,
                    fontWeight: 700,
                    color: "#fff",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {scene.visualRole}
                </div>
              </div>

              {/* Mode label */}
              <div
                style={{
                  fontSize: 9,
                  color: modeColor,
                  fontWeight: 600,
                  textAlign: "center",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {asset.type}
              </div>

              {/* Caption preview */}
              <div
                style={{
                  fontSize: 9,
                  color: "#6b7280",
                  textAlign: "center",
                  lineHeight: 1.3,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {scene.caption}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
