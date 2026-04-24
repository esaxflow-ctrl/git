import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";
import crypto from "crypto";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

// 3 layout variants keyed on scene ID
type Layout = "centered_italic" | "left_block" | "stacked_impact";
function pickLayout(id: string): Layout {
  const n = parseInt(crypto.createHash("md5").update(id).digest("hex").slice(0, 2), 16);
  const layouts: Layout[] = ["centered_italic", "left_block", "stacked_impact"];
  return layouts[n % layouts.length];
}

// Easing variant keyed separately to avoid correlated choices
type EasingVariant = "spring_snappy" | "spring_soft" | "spring_bouncy";
function pickEasing(id: string): { damping: number; stiffness: number; mass: number } {
  const n = parseInt(crypto.createHash("md5").update(id + "q").digest("hex").slice(0, 2), 16);
  const configs = [
    { damping: 14, stiffness: 230, mass: 0.6 },
    { damping: 22, stiffness: 180, mass: 0.9 },
    { damping: 10, stiffness: 280, mass: 0.5 },
  ];
  return configs[n % configs.length];
}

export function QuoteCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const layout = pickLayout(scene.id);
  const springConfig = pickEasing(scene.id);

  const [bg, bg2, accent] = style.colorStrategy.palette;
  const { fontFamily, color, highlightColor } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  const quoteMarkProgress = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 14, stiffness: 120, mass: 1.3 },
  });

  const words = scene.caption.split(" ");
  const emphasisSet = new Set(scene.emphasisWords.map((w) => w.toLowerCase()));

  const attrOpacity = interpolate(frame, [24, 36], [0, 1], { extrapolateRight: "clamp" });
  const attrSlide = interpolate(frame, [24, 36], [14, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  const wordEls = words.map((word, i) => {
    const delay = 6 + i * 3;
    const wp = spring({ frame: Math.max(0, frame - delay), fps, config: springConfig });
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
  });

  const Attribution = () => (
    <div
      style={{
        marginTop: 60,
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 20,
        opacity: attrOpacity,
        transform: `translateY(${attrSlide}px)`,
      }}
    >
      <div style={{ width: 110, height: 2, background: accent ?? "#fff", opacity: 0.5, boxShadow: `0 0 10px ${accent ?? "#fff"}55` }} />
      <div style={{ fontSize: 28, fontFamily, color: accent ?? "#aaa", letterSpacing: 5, textTransform: "uppercase", opacity: 0.75 }}>
        {scene.mood.toUpperCase()}
      </div>
    </div>
  );

  // ── Centered italic (original) ──────────────────────────────────────────────
  if (layout === "centered_italic") {
    return (
      <div
        style={{
          width: "100%", height: "100%",
          background: `linear-gradient(158deg, ${bg ?? "#0a0a0a"} 55%, ${bg2 ?? "#111"} 100%)`,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "100px 80px", opacity: fadeIn, overflow: "hidden",
        }}
      >
        <div style={{ fontSize: 210, fontFamily: "Georgia, serif", color: accent ?? "#fff", opacity: interpolate(quoteMarkProgress, [0, 1], [0, 0.11]), lineHeight: 0.8, alignSelf: "flex-start", marginBottom: -50, transform: `translateY(${interpolate(quoteMarkProgress, [0, 1], [-40, 0])}px)` }}>
          &ldquo;
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", zIndex: 1 }}>
          {wordEls}
        </div>
        <Attribution />
      </div>
    );
  }

  // ── Left block layout ───────────────────────────────────────────────────────
  if (layout === "left_block") {
    return (
      <div
        style={{
          width: "100%", height: "100%",
          background: `linear-gradient(200deg, ${bg ?? "#0a0a0a"} 60%, ${bg2 ?? "#111"} 100%)`,
          display: "flex", flexDirection: "column",
          justifyContent: "center",
          padding: "80px 70px", opacity: fadeIn, overflow: "hidden",
        }}
      >
        {/* Huge quote mark as background element */}
        <div style={{ fontSize: 320, fontFamily: "Georgia, serif", color: accent ?? "#fff", opacity: 0.06, lineHeight: 0.75, position: "absolute", top: 20, left: 40, userSelect: "none" }}>
          &ldquo;
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", zIndex: 1, maxWidth: "88%" }}>
          {wordEls}
        </div>
        <div style={{ marginTop: 52, display: "flex", alignItems: "center", gap: 20, opacity: attrOpacity, transform: `translateY(${attrSlide}px)` }}>
          <div style={{ width: 60, height: 2, background: accent ?? "#fff", opacity: 0.5 }} />
          <div style={{ fontSize: 26, fontFamily, color: accent ?? "#aaa", letterSpacing: 5, textTransform: "uppercase", opacity: 0.75 }}>
            {scene.mood.toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  // ── Stacked impact layout ───────────────────────────────────────────────────
  const impactProgress = spring({ frame: Math.max(0, frame - 4), fps, config: springConfig });
  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: `linear-gradient(180deg, ${bg ?? "#0a0a0a"} 0%, ${bg2 ?? "#111"} 100%)`,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "80px 60px", opacity: fadeIn, overflow: "hidden",
      }}
    >
      {/* Top accent line */}
      <div style={{ width: `${interpolate(impactProgress, [0, 1], [0, 70])}%`, height: 3, background: accent ?? "#fff", opacity: 0.6, marginBottom: 48, boxShadow: `0 0 16px ${accent ?? "#fff"}66` }} />
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 16px" }}>
        {wordEls}
      </div>
      <Attribution />
    </div>
  );
}
