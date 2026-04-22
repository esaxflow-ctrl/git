import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function EvidenceCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [bg, , accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  // "FINDING" header types in character by character
  const HEADER = "FINDING";
  const headerCount = Math.floor(
    interpolate(frame, [4, 20], [0, HEADER.length], {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    })
  );

  // Key term springs in from scale 0.3
  const keyProgress = spring({
    frame: Math.max(0, frame - 12),
    fps,
    config: { damping: 13, stiffness: 140, mass: 1.1 },
  });
  const keyScale = interpolate(keyProgress, [0, 1], [0.3, 1.0]);

  // Caption slides up after key term
  const captionSlide = interpolate(frame, [20, 32], [18, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  const captionOpacity = interpolate(frame, [20, 32], [0, 1], { extrapolateRight: "clamp" });

  // Extract key term — first emphasis word, or first 2 words of sceneGoal
  const keyTerm =
    scene.emphasisWords[0] ?? scene.sceneGoal.split(" ").slice(0, 2).join(" ");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg ?? "#080808",
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
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "22%",
          bottom: "22%",
          width: 9,
          background: accent ?? "#c0392b",
          boxShadow: `0 0 30px ${accent ?? "#c0392b"}99`,
        }}
      />

      {/* Ghost keyword watermark behind */}
      <div
        style={{
          position: "absolute",
          right: -20,
          bottom: 60,
          fontSize: 220,
          fontFamily,
          fontWeight: 900,
          color: accent ?? "#ffffff",
          opacity: 0.04,
          letterSpacing: -4,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        {keyTerm.toUpperCase().slice(0, 6)}
      </div>

      {/* "FINDING" typewriter header */}
      <div
        style={{
          fontSize: 30,
          fontFamily,
          color: accent ?? "#c0392b",
          letterSpacing: 12,
          fontWeight: 700,
          marginBottom: 44,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        {HEADER.slice(0, headerCount)}
        <span
          style={{
            display: "inline-block",
            width: 3,
            height: 32,
            background: accent ?? "#c0392b",
            opacity: frame % 20 < 10 ? 1 : 0,
            marginLeft: 2,
          }}
        />
      </div>

      {/* Key term — springs in large */}
      <div
        style={{
          fontSize: keyTerm.length > 10 ? 72 : 100,
          fontFamily,
          fontWeight: 900,
          color: highlightColor,
          transform: `scale(${keyScale})`,
          opacity: keyProgress,
          transformOrigin: "left center",
          lineHeight: 1.05,
          marginBottom: 44,
          textTransform: "uppercase",
        }}
      >
        {keyTerm}
      </div>

      {/* Caption text */}
      <div
        style={{
          fontSize: 42,
          fontFamily,
          fontWeight: 500,
          color,
          lineHeight: 1.45,
          transform: `translateY(${captionSlide}px)`,
          opacity: captionOpacity,
          maxWidth: "82%",
        }}
      >
        {scene.caption}
      </div>
    </div>
  );
}
