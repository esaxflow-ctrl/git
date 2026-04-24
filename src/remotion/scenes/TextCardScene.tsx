import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from "remotion";
import { ScenePlan, StyleProfile } from "../../lib/validation/schemas";
import crypto from "crypto";

interface Props {
  scene: ScenePlan;
  style: StyleProfile;
}

// 3 deterministic micro-layout variants keyed on scene ID.
type Layout = "centered" | "left_accent" | "bottom_reveal";
function pickLayout(id: string): Layout {
  const n = parseInt(crypto.createHash("md5").update(id).digest("hex").slice(0, 2), 16);
  const layouts: Layout[] = ["centered", "left_accent", "bottom_reveal"];
  return layouts[n % layouts.length];
}

// Per-scene easing variant — never the same between adjacent layouts
type EasingVariant = "cubic" | "back" | "quad";
function pickEasing(id: string): EasingVariant {
  const n = parseInt(crypto.createHash("md5").update(id + "e").digest("hex").slice(0, 2), 16);
  const variants: EasingVariant[] = ["cubic", "back", "quad"];
  return variants[n % variants.length];
}

function resolveEasing(v: EasingVariant) {
  if (v === "back") return Easing.out(Easing.back(1.4));
  if (v === "quad") return Easing.inOut(Easing.quad);
  return Easing.out(Easing.cubic);
}

export function TextCardScene({ scene, style }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = pickLayout(scene.id);
  const easingVariant = pickEasing(scene.id);
  const ease = resolveEasing(easingVariant);

  const [bg, , accent] = style.colorStrategy.palette;
  const { fontFamily, color } = style.captionStyle;

  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  const ruleScale = interpolate(frame, [6, 22], [0, 1], {
    extrapolateRight: "clamp",
    easing: ease,
  });

  const words = scene.caption.split(" ");
  const subtitleOpacity = interpolate(frame, [22, 34], [0, 0.65], { extrapolateRight: "clamp" });
  const subtitleSlide = interpolate(frame, [22, 34], [12, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  const wordEls = words.map((word, i) => {
    const wordDelay = 4 + i * 3;
    const wp = interpolate(frame, [wordDelay, wordDelay + 14], [0, 1], {
      extrapolateRight: "clamp",
      easing: ease,
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
          textTransform: "uppercase" as const,
          filter: `blur(${blur}px)`,
          opacity: wp,
          display: "inline-block",
        }}
      >
        {word}
      </span>
    );
  });

  // ── Centered layout (original) ─────────────────────────────────────────────
  if (layout === "centered") {
    return (
      <div
        style={{
          width: "100%", height: "100%",
          background: bg ?? "#080808",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "80px 70px", opacity: fadeIn,
        }}
      >
        <div style={{ width: `${ruleScale * 55}%`, height: 2, background: accent ?? "#fff", opacity: 0.55, marginBottom: 52, boxShadow: `0 0 12px ${accent ?? "#fff"}55` }} />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 22px" }}>
          {wordEls}
        </div>
        <div style={{ marginTop: 52, fontSize: 30, fontFamily, fontWeight: 400, color: accent ?? "#fff", letterSpacing: 7, textTransform: "uppercase", opacity: subtitleOpacity, textAlign: "center", transform: `translateY(${subtitleSlide}px)` }}>
          {scene.sceneGoal.slice(0, 55)}
        </div>
        <div style={{ width: `${ruleScale * 55}%`, height: 2, background: accent ?? "#fff", opacity: 0.55, marginTop: 52, boxShadow: `0 0 12px ${accent ?? "#fff"}55` }} />
      </div>
    );
  }

  // ── Left accent layout ──────────────────────────────────────────────────────
  if (layout === "left_accent") {
    const barH = interpolate(frame, [4, 28], [0, 1], { extrapolateRight: "clamp", easing: ease });
    return (
      <div
        style={{
          width: "100%", height: "100%",
          background: bg ?? "#080808",
          display: "flex", flexDirection: "row",
          alignItems: "center",
          padding: "80px 60px 80px 50px", opacity: fadeIn,
        }}
      >
        {/* Left accent bar */}
        <div style={{ width: 5, height: `${barH * 55}%`, background: accent ?? "#fff", borderRadius: 3, marginRight: 52, flexShrink: 0, boxShadow: `0 0 18px ${accent ?? "#fff"}66` }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
            {wordEls}
          </div>
          <div style={{ fontSize: 28, fontFamily, color: accent ?? "#fff", letterSpacing: 5, textTransform: "uppercase", opacity: subtitleOpacity, transform: `translateY(${subtitleSlide}px)` }}>
            {scene.sceneGoal.slice(0, 55)}
          </div>
        </div>
      </div>
    );
  }

  // ── Bottom reveal layout ────────────────────────────────────────────────────
  const bottomProgress = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: { damping: 18, stiffness: 160, mass: 1 },
  });
  return (
    <div
      style={{
        width: "100%", height: "100%",
        background: bg ?? "#080808",
        display: "flex", flexDirection: "column",
        justifyContent: "flex-end",
        padding: "0 70px 140px", opacity: fadeIn,
      }}
    >
      <div style={{ transform: `translateY(${interpolate(bottomProgress, [0, 1], [60, 0])}px)`, opacity: bottomProgress }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px" }}>
          {wordEls}
        </div>
        <div style={{ marginTop: 36, width: `${ruleScale * 45}%`, height: 2, background: accent ?? "#fff", opacity: 0.55, boxShadow: `0 0 12px ${accent ?? "#fff"}55` }} />
        <div style={{ marginTop: 28, fontSize: 30, fontFamily, color: accent ?? "#fff", letterSpacing: 6, textTransform: "uppercase", opacity: subtitleOpacity }}>
          {scene.sceneGoal.slice(0, 55)}
        </div>
      </div>
    </div>
  );
}
