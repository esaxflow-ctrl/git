import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function TimelineCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [bg, bg2, accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  // Split narration into steps on sentence boundaries
  const rawSteps = scene.narration
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 4);
  const steps = rawSteps.length > 0 ? rawSteps : [scene.caption];

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  // Section label drops in
  const labelProgress = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 16, stiffness: 220, mass: 0.7 },
  });

  const sectionLabel =
    scene.visualRole === "evidence"
      ? "THE EVIDENCE"
      : scene.visualRole === "hook"
      ? "THE SETUP"
      : scene.visualRole === "climax"
      ? "THE TURN"
      : scene.visualRole === "resolution"
      ? "THE ANSWER"
      : "BREAKDOWN";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(180deg, ${bg ?? "#0a0a0a"} 0%, ${bg2 ?? "#111111"} 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "100px 90px",
        opacity: fadeIn,
      }}
    >
      {/* Section label */}
      <div
        style={{
          fontSize: 28,
          fontFamily,
          color: accent ?? "#ffffff",
          letterSpacing: 9,
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: 52,
          opacity: labelProgress,
          transform: `translateY(${interpolate(labelProgress, [0, 1], [-16, 0])}px)`,
        }}
      >
        {sectionLabel}
      </div>

      {/* Steps */}
      {steps.map((step, i) => {
        const stepDelay = 8 + i * 9;
        const sp = spring({
          frame: Math.max(0, frame - stepDelay),
          fps,
          config: { damping: 16, stiffness: 200, mass: 0.8 },
        });
        const isFirst = i === 0;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 30,
              marginBottom: 40,
              opacity: sp,
              transform: `translateX(${interpolate(sp, [0, 1], [-36, 0])}px)`,
            }}
          >
            {/* Step circle */}
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                background: isFirst ? (accent ?? "#ffffff") : "transparent",
                border: `3px solid ${accent ?? "#ffffff"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 26,
                fontFamily,
                fontWeight: 700,
                color: isFirst ? (bg ?? "#0a0a0a") : (accent ?? "#ffffff"),
                boxShadow: isFirst ? `0 0 20px ${accent ?? "#ffffff"}55` : "none",
              }}
            >
              {i + 1}
            </div>

            {/* Connector line below (except last) */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div
                style={{
                  fontSize: steps.length <= 2 ? 46 : 38,
                  fontFamily,
                  fontWeight: isFirst ? 700 : 400,
                  color: isFirst ? highlightColor : color,
                  lineHeight: 1.35,
                  opacity: isFirst ? 1 : 0.72,
                }}
              >
                {step}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
