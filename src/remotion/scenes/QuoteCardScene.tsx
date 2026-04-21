import { useCurrentFrame, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function QuoteCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();

  const [bg, , accent] = style.colorStrategy.palette;
  const { fontFamily, color } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 20], [0, 1], {
    easing: Easing.out(Easing.ease),
    extrapolateRight: "clamp",
  });

  const quoteSlide = interpolate(frame, [0, 20], [30, 0], {
    easing: Easing.out(Easing.ease),
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg ?? "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 60px",
        opacity: fadeIn,
      }}
    >
      {/* Opening quote mark */}
      <div
        style={{
          fontSize: 180,
          fontFamily: "Georgia, serif",
          color: accent ?? "#ffffff",
          opacity: 0.15,
          lineHeight: 1,
          alignSelf: "flex-start",
          marginBottom: -60,
        }}
      >
        "
      </div>

      {/* Quote text */}
      <div
        style={{
          fontSize: 64,
          fontFamily: `${fontFamily}, Georgia, serif`,
          fontStyle: "italic",
          color,
          textAlign: "center",
          lineHeight: 1.4,
          transform: `translateY(${quoteSlide}px)`,
          zIndex: 1,
        }}
      >
        {scene.caption}
      </div>

      {/* Divider */}
      <div
        style={{
          width: 200,
          height: 3,
          background: accent ?? "#ffffff",
          opacity: 0.4,
          marginTop: 40,
        }}
      />

      {/* Mood label */}
      <div
        style={{
          marginTop: 24,
          fontSize: 32,
          fontFamily,
          color: accent ?? "#ffffff",
          opacity: 0.6,
          letterSpacing: 6,
          textTransform: "uppercase",
        }}
      >
        {scene.mood}
      </div>

      {/* Closing quote mark */}
      <div
        style={{
          fontSize: 180,
          fontFamily: "Georgia, serif",
          color: accent ?? "#ffffff",
          opacity: 0.15,
          lineHeight: 1,
          alignSelf: "flex-end",
          marginTop: -60,
        }}
      >
        "
      </div>
    </div>
  );
}
