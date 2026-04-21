import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { CaptionEntry, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  captionEntries: CaptionEntry[];
  style: StyleProfile;
  compositionOffsetMs?: number;
}

export function CaptionLayer({ captionEntries, style, compositionOffsetMs = 0 }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentMs = (frame / fps) * 1000 + compositionOffsetMs;

  const active = captionEntries.find(
    (e) => currentMs >= e.startMs && currentMs < e.endMs
  );

  if (!active) return null;

  // Non-null assertion — we checked above; inner functions need a stable non-optional reference
  const activeEntry = active;

  const { captionStyle, colorStrategy } = style;
  const {
    fontFamily,
    fontSize,
    color,
    highlightColor,
    animation,
    position,
  } = captionStyle;

  const entryProgress = (currentMs - activeEntry.startMs) / (activeEntry.endMs - activeEntry.startMs);

  const positionStyle: React.CSSProperties =
    position === "bottom"
      ? { bottom: 120 }
      : position === "top"
      ? { top: 120 }
      : { top: "50%", transform: "translateY(-50%)" };

  const words = activeEntry.text.split(" ");
  const emphasisSet = new Set(activeEntry.emphasisWords.map((w) => w.toLowerCase()));

  function renderWordPop() {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        {words.map((word, i) => {
          const clean = word.toLowerCase().replace(/[^a-z]/g, "");
          const isEmphasis = emphasisSet.has(clean);
          const wordProgress = spring({
            frame: Math.max(0, frame),
            fps,
            config: { damping: 15, stiffness: 300, mass: 0.5 },
          });
          const scale = isEmphasis
            ? interpolate(wordProgress, [0, 1], [0.8, 1.15])
            : 1;

          return (
            <span
              key={i}
              style={{
                fontSize: isEmphasis ? fontSize * 1.15 : fontSize,
                fontFamily,
                fontWeight: isEmphasis ? 900 : 700,
                color: isEmphasis ? highlightColor : color,
                transform: `scale(${scale})`,
                display: "inline-block",
                textShadow: "0 2px 8px rgba(0,0,0,0.8)",
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
    const slideY = interpolate(frame, [0, 8], [30, 0], {
      extrapolateRight: "clamp",
    });
    const opacity = interpolate(frame, [0, 6], [0, 1], {
      extrapolateRight: "clamp",
    });
    return (
      <div
        style={{
          transform: `translateY(${slideY}px)`,
          opacity,
          fontSize,
          fontFamily,
          fontWeight: 700,
          color,
          textAlign: "center",
          textShadow: "0 2px 12px rgba(0,0,0,0.9)",
          lineHeight: 1.3,
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
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.3,
        }}
      >
        {activeEntry.text.split("").map((char, i) => (
          <span
            key={i}
            style={{
              color: i <= charProgress ? highlightColor : color,
              textShadow:
                i <= charProgress
                  ? `0 0 20px ${highlightColor}66`
                  : "0 2px 8px rgba(0,0,0,0.8)",
              transition: "color 0.1s",
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
          fontWeight: 700,
          color,
          textAlign: "center",
          textShadow: "0 2px 8px rgba(0,0,0,0.8)",
          lineHeight: 1.3,
        }}
      >
        {activeEntry.text.slice(0, charCount)}
        <span style={{ opacity: Math.round(frame % 30 / 15) }}>|</span>
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

  const tint = colorStrategy.tint ?? "rgba(0,0,0,0.45)";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...positionStyle,
        padding: "0 40px",
        zIndex: 10,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: tint,
          borderRadius: 16,
          padding: "16px 28px",
          maxWidth: "90%",
          backdropFilter: "blur(4px)",
        }}
      >
        {content}
      </div>
    </div>
  );
}
