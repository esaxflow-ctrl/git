import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function TextCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [bg, , accent] = style.colorStrategy.palette;
  const { fontFamily, color } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  // Horizontal rules scale in from center
  const ruleScale = interpolate(frame, [6, 22], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Words reveal with blur → clear, staggered
  const words = scene.caption.split(" ");

  // Subtitle fades in last
  const subtitleOpacity = interpolate(frame, [22, 34], [0, 0.65], { extrapolateRight: "clamp" });
  const subtitleSlide = interpolate(frame, [22, 34], [12, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg ?? "#080808",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 70px",
        opacity: fadeIn,
      }}
    >
      {/* Top rule */}
      <div
        style={{
          width: `${ruleScale * 55}%`,
          height: 2,
          background: accent ?? "#ffffff",
          opacity: 0.55,
          marginBottom: 52,
          boxShadow: `0 0 12px ${accent ?? "#ffffff"}55`,
        }}
      />

      {/* Words — blur-to-clear stagger */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "6px 22px",
        }}
      >
        {words.map((word, i) => {
          const wordDelay = 4 + i * 3;
          const wp = interpolate(frame, [wordDelay, wordDelay + 14], [0, 1], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          const blur = interpolate(wp, [0, 1], [18, 0]);

          return (
            <span
              key={i}
              style={{
                fontSize: words.length <= 4 ? 88 : words.length <= 7 ? 76 : 64,
                fontFamily,
                fontWeight: 700,
                color,
                letterSpacing: 3,
                textTransform: "uppercase",
                filter: `blur(${blur}px)`,
                opacity: wp,
                display: "inline-block",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {/* Subtitle — scene goal */}
      <div
        style={{
          marginTop: 52,
          fontSize: 30,
          fontFamily,
          fontWeight: 400,
          color: accent ?? "#ffffff",
          letterSpacing: 7,
          textTransform: "uppercase",
          opacity: subtitleOpacity,
          textAlign: "center",
          transform: `translateY(${subtitleSlide}px)`,
        }}
      >
        {scene.sceneGoal.slice(0, 55)}
      </div>

      {/* Bottom rule */}
      <div
        style={{
          width: `${ruleScale * 55}%`,
          height: 2,
          background: accent ?? "#ffffff",
          opacity: 0.55,
          marginTop: 52,
          boxShadow: `0 0 12px ${accent ?? "#ffffff"}55`,
        }}
      />
    </div>
  );
}
