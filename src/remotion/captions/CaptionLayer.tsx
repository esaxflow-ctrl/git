import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { CaptionEntry, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  captionEntries: CaptionEntry[];
  style: StyleProfile;
  compositionOffsetMs?: number;
}

// 9:16 safe zone: keep captions between 15% and 80% of height
// Top 15% = status bar / notch; Bottom 20% = home indicator / nav UI
const SAFE_TOP_PX = 288;   // 15% of 1920
const SAFE_BOTTOM_PX = 320; // ~17% from bottom of 1920

export function CaptionLayer({ captionEntries, style, compositionOffsetMs = 0 }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentMs = (frame / fps) * 1000 + compositionOffsetMs;

  const active = captionEntries.find(
    (e) => currentMs >= e.startMs && currentMs < e.endMs
  );

  if (!active) return null;

  const activeEntry = active;

  const { captionStyle } = style;
  // maxWordsPerGroup is consumed in groupWordTimings; not used here directly.
  const { fontFamily, fontSize, color, highlightColor, animation, position } = captionStyle;

  // Per-caption local frame so slide-in / typewriter animations replay for
  // every entry, not just the first one. (Bug fix: was using absolute frame.)
  const localFrame = Math.max(0, frame - Math.round((activeEntry.startMs / 1000) * fps));

  const entryProgress = (currentMs - activeEntry.startMs) / (activeEntry.endMs - activeEntry.startMs);

  // Safe zone positioning
  const positionStyle: React.CSSProperties =
    position === "top"
      ? { top: SAFE_TOP_PX }
      : position === "center"
      ? { top: "50%", transform: "translateY(-50%)" }
      : { bottom: SAFE_BOTTOM_PX }; // "bottom" default

  const words = activeEntry.text.split(" ");
  const emphasisSet = new Set(activeEntry.emphasisWords.map((w) => w.toLowerCase()));

  // Thick black stroke rendered as 8 offset text-shadows — readable on
  // any background, no pill needed. Multiplied by 2 for the emphasis word.
  const STROKE = "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 6px 18px rgba(0,0,0,0.85)";

  function renderWordPop() {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 14px" }}>
        {words.map((word, i) => {
          const clean = word.toLowerCase().replace(/[^a-z]/g, "");
          const isEmphasis = emphasisSet.has(clean);
          const wp = spring({
            frame: Math.max(0, localFrame - i * 2),
            fps,
            config: { damping: 15, stiffness: 320, mass: 0.45 },
          });
          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? fontSize * 1.22 : fontSize,
                fontFamily,
                fontWeight: 900,
                color: isEmphasis ? highlightColor : color,
                transform: `scale(${interpolate(wp, [0, 1], [0.7, isEmphasis ? 1.12 : 1.0])})`,
                display: "inline-block",
                textShadow: STROKE,
                letterSpacing: -1,
                lineHeight: 1.1,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    );
  }

  function renderPhraseSlide() {
    const slideY = interpolate(localFrame, [0, 10], [24, 0], { extrapolateRight: "clamp" });
    const opacity = interpolate(localFrame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    return (
      <div
        style={{
          transform: `translateY(${slideY}px)`,
          opacity,
          fontSize,
          fontFamily,
          fontWeight: 900,
          color,
          textAlign: "center",
          textShadow: STROKE,
          letterSpacing: -1,
          lineHeight: 1.15,
        }}
      >
        {activeEntry.text}
      </div>
    );
  }

  function renderKaraoke() {
    const charProgress = Math.floor(entryProgress * activeEntry.text.length);
    return (
      <div
        style={{
          fontSize,
          fontFamily,
          fontWeight: 900,
          textAlign: "center",
          lineHeight: 1.15,
          letterSpacing: -1,
          textShadow: STROKE,
        }}
      >
        {activeEntry.text.split("").map((char, i) => (
          <span
            key={i}
            style={{
              color: i <= charProgress ? highlightColor : color,
            }}
          >
            {char}
          </span>
        ))}
      </div>
    );
  }

  function renderTypewriter() {
    const charCount = Math.floor(entryProgress * activeEntry.text.length);
    return (
      <div
        style={{
          fontSize,
          fontFamily,
          fontWeight: 900,
          color,
          textAlign: "center",
          textShadow: STROKE,
          letterSpacing: -1,
          lineHeight: 1.15,
        }}
      >
        {activeEntry.text.slice(0, charCount)}
        <span style={{ opacity: Math.round((localFrame % 28) / 14) }}>|</span>
      </div>
    );
  }

  let content: React.ReactNode;
  switch (animation) {
    case "word_pop":
      content = renderWordPop();
      break;
    case "karaoke":
      content = renderKaraoke();
      break;
    case "typewriter":
      content = renderTypewriter();
      break;
    case "phrase_slide":
    default:
      content = renderPhraseSlide();
  }

  // No background pill. Modern short-form captions sit directly on the
  // photo with a thick black stroke for legibility — that's the look
  // the user asked for ("not a quote-card box"). Stroke is rendered via
  // multiple text-shadow offsets, which is the only way Remotion's
  // Chromium can draw a real outline without WebKitTextStroke clipping
  // the glyphs at extreme weights.
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...positionStyle,
        padding: "0 56px",
        zIndex: 10,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: "92%" }}>{content}</div>
    </div>
  );
}
