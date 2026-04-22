import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function GradientMotionCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const [bg1, bg2, accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  // Gradient angle drifts slowly
  const angle = interpolate(frame, [0, durationInFrames], [135, 160], {
    easing: Easing.inOut(Easing.sin),
    extrapolateRight: "clamp",
  });

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  // Goal label slides up
  const labelSlide = interpolate(frame, [0, 14], [18, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const labelOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });

  // Caption words spring in staggered
  const words = scene.caption.split(" ");
  const emphasisSet = new Set(scene.emphasisWords.map((w) => w.toLowerCase()));

  // Mood tag fades in at end
  const moodOpacity = interpolate(frame, [22, 32], [0, 0.75], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(${angle}deg, ${bg1 ?? "#0a0a0a"} 0%, ${bg2 ?? "#1a1a2e"} 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "120px 90px",
        opacity: fadeIn,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left accent stripe */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "28%",
          bottom: "28%",
          width: 7,
          background: accent ?? "#c0392b",
          borderRadius: "0 4px 4px 0",
          boxShadow: `0 0 20px ${accent ?? "#c0392b"}88`,
        }}
      />

      {/* Scene goal — small caps label */}
      <div
        style={{
          fontSize: 28,
          fontFamily,
          color: accent ?? "#aaaaaa",
          letterSpacing: 8,
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: 36,
          transform: `translateY(${labelSlide}px)`,
          opacity: labelOpacity,
        }}
      >
        {scene.sceneGoal.slice(0, 45)}
      </div>

      {/* Caption words spring in */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>
        {words.map((word, i) => {
          const delay = i * 2;
          const wp = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 14, stiffness: 190, mass: 0.7 },
          });
          const isEmphasis = emphasisSet.has(word.toLowerCase().replace(/[^a-z]/g, ""));
          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? 78 : 66,
                fontFamily,
                fontWeight: isEmphasis ? 900 : 700,
                color: isEmphasis ? highlightColor : color,
                transform: `translateY(${interpolate(wp, [0, 1], [28, 0])}px)`,
                opacity: wp,
                display: "inline-block",
                textShadow: isEmphasis ? `0 0 40px ${highlightColor}55` : "none",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {/* Mood tag */}
      <div
        style={{
          marginTop: 52,
          fontSize: 28,
          fontFamily,
          color: accent ?? "#ffffff",
          letterSpacing: 8,
          textTransform: "uppercase",
          opacity: moodOpacity,
        }}
      >
        — {scene.mood}
      </div>
    </div>
  );
}
