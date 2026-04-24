import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";
import md5 from "md5";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

// 3 micro-layout variants — selected deterministically from scene ID so the
// same scene always renders the same variant, and different scenes vary.
type LayoutVariant = "left_accent" | "bottom_reveal" | "centered_impact";

function pickVariant(sceneId: string): LayoutVariant {
  const variants: LayoutVariant[] = ["left_accent", "bottom_reveal", "centered_impact"];
  const hash = md5(sceneId);
  const idx = parseInt(hash.slice(0, 4), 16) % variants.length;
  return variants[idx];
}

export function GradientMotionCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const [bg1, bg2, accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  const variant = pickVariant(scene.id);

  // Gradient angle drifts slowly for motion without using a video
  const angle = interpolate(frame, [0, durationInFrames], [135, 162], {
    easing: Easing.inOut(Easing.sin),
    extrapolateRight: "clamp",
  });

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  const words = scene.caption.split(" ");
  const emphasisSet = new Set(scene.emphasisWords.map((w) => w.toLowerCase()));

  // Shared: goal label slides up
  const labelSlide = interpolate(frame, [0, 16], [22, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const labelOpacity = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });

  // Mood tag fades in later
  const moodOpacity = interpolate(frame, [24, 36], [0, 0.72], { extrapolateRight: "clamp" });

  function renderWords(fontSize: number, align: "flex-start" | "center" | "flex-end" = "flex-start") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", justifyContent: align }}>
        {words.map((word, i) => {
          const delay = i * 2;
          const wp = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 14, stiffness: 200, mass: 0.65 },
          });
          const isEmphasis = emphasisSet.has(word.toLowerCase().replace(/[^a-z]/g, ""));
          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? fontSize * 1.18 : fontSize,
                fontFamily,
                fontWeight: isEmphasis ? 900 : 700,
                color: isEmphasis ? highlightColor : color,
                transform: `translateY(${interpolate(wp, [0, 1], [30, 0])}px)`,
                opacity: wp,
                display: "inline-block",
                lineHeight: 1.1,
                textShadow: isEmphasis ? `0 0 40px ${highlightColor}55` : "none",
                letterSpacing: isEmphasis ? -1 : 0,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  // ── Layout A: Left accent stripe + large left-aligned type ─────────────────
  if (variant === "left_accent") {
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
        {/* Accent stripe */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "26%",
            bottom: "26%",
            width: 8,
            background: accent ?? "#c0392b",
            borderRadius: "0 4px 4px 0",
            boxShadow: `0 0 28px ${accent ?? "#c0392b"}88`,
          }}
        />

        {/* Scene goal label */}
        <div
          style={{
            fontSize: 26,
            fontFamily,
            color: accent ?? "#aaaaaa",
            letterSpacing: 7,
            textTransform: "uppercase",
            fontWeight: 700,
            marginBottom: 40,
            transform: `translateY(${labelSlide}px)`,
            opacity: labelOpacity,
          }}
        >
          {scene.sceneGoal.slice(0, 40)}
        </div>

        {renderWords(68)}

        {/* Mood tag */}
        <div
          style={{
            marginTop: 56,
            fontSize: 26,
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

  // ── Layout B: Bottom reveal — content rises from below ─────────────────────
  if (variant === "bottom_reveal") {
    const revealY = interpolate(frame, [0, 20], [60, 0], {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    const revealOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: `linear-gradient(${angle}deg, ${bg2 ?? "#1a1a2e"} 0%, ${bg1 ?? "#0a0a0a"} 60%, #000 100%)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          padding: "80px 80px 160px",
          opacity: fadeIn,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Horizontal rule that scales in */}
        <div
          style={{
            width: interpolate(frame, [8, 24], [0, 120], { extrapolateRight: "clamp" }),
            height: 3,
            background: accent ?? "#e74c3c",
            marginBottom: 28,
            borderRadius: 2,
            boxShadow: `0 0 16px ${accent ?? "#e74c3c"}88`,
          }}
        />

        <div
          style={{
            transform: `translateY(${revealY}px)`,
            opacity: revealOpacity,
          }}
        >
          {renderWords(72)}

          <div
            style={{
              marginTop: 40,
              fontSize: 24,
              fontFamily,
              color: `${color}99`,
              letterSpacing: 5,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {scene.visualRole.toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  // ── Layout C: Centered impact — giant centered word(s), minimal ────────────
  const centerScale = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 160, mass: 0.9 },
  });
  const centerOpacity = interpolate(centerScale, [0, 1], [0, 1]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(ellipse at center, ${bg2 ?? "#1a1a2e"} 0%, ${bg1 ?? "#000000"} 70%)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 60px",
        opacity: fadeIn,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Large ghosted circle behind text */}
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          border: `2px solid ${accent ?? "#ffffff"}18`,
          transform: `scale(${interpolate(frame, [0, durationInFrames], [0.9, 1.1], { extrapolateRight: "clamp" })})`,
        }}
      />

      {/* Goal label */}
      <div
        style={{
          fontSize: 22,
          fontFamily,
          color: `${accent ?? "#aaaaaa"}cc`,
          letterSpacing: 8,
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: 48,
          opacity: labelOpacity,
        }}
      >
        {scene.sceneGoal.slice(0, 36)}
      </div>

      <div
        style={{
          transform: `scale(${interpolate(centerScale, [0, 1], [0.82, 1.0])})`,
          opacity: centerOpacity,
          textAlign: "center",
        }}
      >
        {renderWords(80, "center")}
      </div>

      {/* Bottom accent line */}
      <div
        style={{
          position: "absolute",
          bottom: 180,
          width: interpolate(frame, [14, 30], [0, 200], { extrapolateRight: "clamp" }),
          height: 2,
          background: accent ?? "#e74c3c",
          borderRadius: 1,
          opacity: 0.7,
        }}
      />
    </div>
  );
}
