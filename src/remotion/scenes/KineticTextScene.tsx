import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

export function KineticTextScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = scene.caption.split(" ");
  const [bg1, bg2] = style.colorStrategy.palette;
  const { color, highlightColor, fontFamily, fontSize } = style.captionStyle;
  const emphasisSet = new Set(scene.emphasisWords.map((w) => w.toLowerCase()));

  const bgOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${bg1}, ${bg2})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: bgOpacity,
        padding: "80px 60px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
        }}
      >
        {words.map((word, i) => {
          const delay = i * 3;
          const wordProgress = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 12, stiffness: 200, mass: 0.6 },
          });

          const isEmphasis = emphasisSet.has(word.toLowerCase().replace(/[^a-z]/g, ""));
          const wordScale = isEmphasis
            ? interpolate(wordProgress, [0, 1], [0.5, 1.1])
            : interpolate(wordProgress, [0, 1], [0, 1]);
          const wordY = interpolate(wordProgress, [0, 1], [40, 0]);

          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? fontSize * 1.2 : fontSize,
                fontFamily,
                fontWeight: isEmphasis ? 900 : 700,
                color: isEmphasis ? highlightColor : color,
                transform: `translateY(${wordY}px) scale(${wordScale})`,
                display: "inline-block",
                opacity: wordProgress,
                textShadow: isEmphasis ? `0 0 30px ${highlightColor}88` : "none",
              }}
            >
              {word}
            </span>
          );
        })}
      </div>

      {scene.mood && (
        <div
          style={{
            marginTop: 60,
            fontSize: 32,
            fontFamily,
            color: highlightColor,
            opacity: interpolate(frame, [15, 25], [0, 0.6], { extrapolateRight: "clamp" }),
            letterSpacing: 8,
            textTransform: "uppercase",
          }}
        >
          {scene.mood}
        </div>
      )}
    </div>
  );
}
