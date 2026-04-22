import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function QuoteCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [bg, bg2, accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  // Opening quote mark drops in with spring
  const quoteMarkProgress = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 14, stiffness: 120, mass: 1.3 },
  });

  // Caption words spring in one by one
  const words = scene.caption.split(" ");
  const emphasisSet = new Set(scene.emphasisWords.map((w) => w.toLowerCase()));

  // Divider + attribution slide up
  const attrOpacity = interpolate(frame, [24, 36], [0, 1], { extrapolateRight: "clamp" });
  const attrSlide = interpolate(frame, [24, 36], [14, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(158deg, ${bg ?? "#0a0a0a"} 55%, ${bg2 ?? "#111111"} 100%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "100px 80px",
        opacity: fadeIn,
        overflow: "hidden",
      }}
    >
      {/* Large opening quote mark */}
      <div
        style={{
          fontSize: 210,
          fontFamily: "Georgia, serif",
          color: accent ?? "#ffffff",
          opacity: interpolate(quoteMarkProgress, [0, 1], [0, 0.11]),
          lineHeight: 0.8,
          alignSelf: "flex-start",
          marginBottom: -50,
          transform: `translateY(${interpolate(quoteMarkProgress, [0, 1], [-40, 0])}px)`,
        }}
      >
        &ldquo;
      </div>

      {/* Words spring in */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "8px 16px",
          zIndex: 1,
        }}
      >
        {words.map((word, i) => {
          const delay = 6 + i * 3;
          const wp = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 14, stiffness: 230, mass: 0.6 },
          });
          const isEmphasis = emphasisSet.has(word.toLowerCase().replace(/[^a-z]/g, ""));
          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? 74 : 64,
                fontFamily: `${fontFamily}, Georgia, serif`,
                fontStyle: "italic",
                fontWeight: isEmphasis ? 800 : 400,
                color: isEmphasis ? highlightColor : color,
                transform: `translateY(${interpolate(wp, [0, 1], [22, 0])}px)`,
                opacity: wp,
                display: "inline-block",
                textShadow: isEmphasis ? `0 0 35px ${highlightColor}44` : "none",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {/* Divider + mood attribution */}
      <div
        style={{
          marginTop: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          opacity: attrOpacity,
          transform: `translateY(${attrSlide}px)`,
        }}
      >
        <div
          style={{
            width: 110,
            height: 2,
            background: accent ?? "#ffffff",
            opacity: 0.5,
            boxShadow: `0 0 10px ${accent ?? "#ffffff"}55`,
          }}
        />
        <div
          style={{
            fontSize: 28,
            fontFamily,
            color: accent ?? "#aaaaaa",
            letterSpacing: 5,
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          {scene.mood.toUpperCase()}
        </div>
      </div>
    </div>
  );
}
