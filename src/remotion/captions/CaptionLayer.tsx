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
  const { fontFamily, fontSize, color, highlightColor, animation, position, maxWordsPerGroup } = captionStyle;

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

  function renderWordPop() {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 10px" }}>
        {words.map((word, i) => {
          const clean = word.toLowerCase().replace(/[^a-z]/g, "");
          const isEmphasis = emphasisSet.has(clean);
          const wp = spring({
            frame: Math.max(0, frame - i * 2),
            fps,
            config: { damping: 15, stiffness: 320, mass: 0.45 },
          });
          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? fontSize * 1.18 : fontSize,
                fontFamily,
                fontWeight: isEmphasis ? 900 : 800,
                color: isEmphasis ? highlightColor : color,
                transform: `scale(${interpolate(wp, [0, 1], [0.7, isEmphasis ? 1.12 : 1.0])})`,
                display: "inline-block",
                textShadow: "0 3px 12px rgba(0,0,0,0.9)",
                WebkitTextStroke: "1px rgba(0,0,0,0.3)",
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
    const slideY = interpolate(frame, [0, 10], [24, 0], { extrapolateRight: "clamp" });
    const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    return (
      <div
        style={{
          transform: `translateY(${slideY}px)`,
          opacity,
          fontSize,
          fontFamily,
          fontWeight: 800,
          color,
          textAlign: "center",
          textShadow: "0 3px 14px rgba(0,0,0,0.95)",
          lineHeight: 1.25,
          WebkitTextStroke: "1px rgba(0,0,0,0.25)",
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
          fontWeight: 800,
          textAlign: "center",
          lineHeight: 1.25,
        }}
      >
        {activeEntry.text.split("").map((char, i) => (
          <span
            key={i}
            style={{
              color: i <= charProgress ? highlightColor : color,
              textShadow:
                i <= charProgress
                  ? `0 0 22px ${highlightColor}77, 0 2px 8px rgba(0,0,0,0.9)`
                  : "0 2px 8px rgba(0,0,0,0.85)",
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
          fontWeight: 800,
          color,
          textAlign: "center",
          textShadow: "0 2px 10px rgba(0,0,0,0.9)",
          lineHeight: 1.25,
        }}
      >
        {activeEntry.text.slice(0, charCount)}
        <span style={{ opacity: Math.round((frame % 28) / 14) }}>|</span>
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

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...positionStyle,
        padding: "0 48px",
        zIndex: 10,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.52)",
          borderRadius: 18,
          padding: "18px 32px",
          maxWidth: "88%",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {content}
      </div>
    </div>
  );
}
