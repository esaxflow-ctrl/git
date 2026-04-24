import {
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Audio,
  interpolate,
  Easing,
} from "remotion";
import {
  ShortFormVideoProps,
  VisualAsset,
  ScenePlan,
  StyleProfile,
  SceneWithTiming,
  VisualRole,
  PacingMode,
  MotionStyle,
} from "../lib/validation/schemas";

type PanDirection = "right" | "left" | "up" | "down";
const PAN_DIRS: PanDirection[] = ["right", "left", "up", "down"];
import { VideoScene } from "./scenes/VideoScene";
import { ImageScene } from "./scenes/ImageScene";
import { GradientMotionCardScene } from "./scenes/GradientMotionCardScene";
import { TextCardScene } from "./scenes/TextCardScene";
import { EvidenceCardScene } from "./scenes/EvidenceCardScene";
import { TimelineCardScene } from "./scenes/TimelineCardScene";
import { KineticTextScene } from "./scenes/KineticTextScene";
import { QuoteCardScene } from "./scenes/QuoteCardScene";
import { CaptionLayer } from "./captions/CaptionLayer";

interface MotionConfig {
  style: MotionStyle;
  // 0.0 = barely moves, 1.0 = full amplitude
  amplitude: number;
  direction: PanDirection;
}

// Role + pacing → motion style, amplitude, and pan direction.
// Direction cycles per sceneIndex so adjacent scenes never pan the same way.
function computeMotion(
  base: MotionStyle,
  role: VisualRole | undefined,
  pacing: PacingMode | undefined,
  sceneIndex: number,
): MotionConfig {
  const direction = PAN_DIRS[sceneIndex % 4];

  // Amplitude by pacing
  let amplitude = 0.75;
  if (pacing === "dramatic_pause") amplitude = 0.2;
  else if (pacing === "slow") amplitude = 0.55;
  else if (pacing === "fast") amplitude = 1.0;

  // Style by role, with pacing fallback
  let style: MotionStyle = base;
  if (role === "hook") { style = "zoom_in"; amplitude = 1.0; }
  else if (role === "climax") { style = "parallax"; amplitude = Math.min(1.0, amplitude + 0.2); }
  else if (role === "resolution") { style = "ken_burns"; }
  else if (role === "evidence" && pacing === "dramatic_pause") { style = "static"; amplitude = 0; }
  else if (role === "evidence") { style = "drift"; amplitude *= 0.6; }
  else if (pacing === "fast") style = "zoom_in";
  else if (pacing === "slow") style = "ken_burns";

  return { style, amplitude, direction };
}

function SceneContent({
  scene,
  asset,
  style,
  sceneIndex,
}: {
  scene: ScenePlan;
  asset: VisualAsset;
  style: StyleProfile;
  sceneIndex: number;
}) {
  const { style: motionStyle, amplitude, direction } = computeMotion(
    style.motionStyle,
    scene.visualRole,
    scene.pacing,
    sceneIndex,
  );
  switch (asset.type) {
    case "stockVideo":
      return <VideoScene asset={asset} motionStyle={motionStyle} />;
    case "stockImage":
      return (
        <ImageScene
          asset={asset}
          motionStyle={motionStyle}
          amplitude={amplitude}
          direction={direction}
        />
      );
    case "gradientMotionCard":
    case "mapCard":
      return <GradientMotionCardScene scene={scene} style={style} />;
    case "textCard":
      return <TextCardScene scene={scene} style={style} />;
    case "evidenceCard":
      return <EvidenceCardScene scene={scene} style={style} />;
    case "timelineCard":
      return <TimelineCardScene scene={scene} style={style} />;
    case "quoteCard":
      return <QuoteCardScene scene={scene} style={style} />;
    default:
      return <KineticTextScene scene={scene} style={style} />;
  }
}

function Vignette({ strength }: { strength: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,${strength}) 100%)`,
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}

function ColorTint({ tint }: { tint: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: tint,
        pointerEvents: "none",
        zIndex: 4,
        mixBlendMode: "multiply",
      }}
    />
  );
}

// Global transition layer — operates on absolute frame so outgoing/incoming
// transitions are correctly choreographed at scene boundaries, not at local
// frame=0 inside each Sequence.
function GlobalTransitionLayer({
  scenesWithTiming,
  transitionStyle,
}: {
  scenesWithTiming: SceneWithTiming[];
  transitionStyle: string;
}) {
  const frame = useCurrentFrame();

  if (transitionStyle === "cut") return null;

  // Find the nearest scene boundary (start of scene i+1 for i>=1)
  for (let i = 1; i < scenesWithTiming.length; i++) {
    const boundary = scenesWithTiming[i].startFrame;
    const d = frame - boundary; // d < 0 = still in previous scene, d >= 0 = in new scene

    if (transitionStyle === "fade" && d >= -8 && d <= 12) {
      const opacity =
        d < 0
          ? interpolate(d, [-8, 0], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          : interpolate(d, [0, 12], [0.92, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "black",
            opacity,
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      );
    }

    if (transitionStyle === "glitch" && d >= -3 && d <= 6) {
      const absD = Math.abs(d);
      const tx = d < 0
        ? interpolate(d, [-3, 0], [0, 22], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(d, [0, 3, 6], [22, -12, 0]);
      const opacity = interpolate(absD, [0, 5], [0.88, 0], { extrapolateRight: "clamp" });
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "white",
            transform: `translateX(${tx}px)`,
            opacity,
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      );
    }

    if (transitionStyle === "zoom_through" && d >= -4 && d <= 10) {
      const absD = Math.abs(d);
      const scale = interpolate(absD, [0, 5], [1.38, 1.0], {
        easing: Easing.out(Easing.ease),
        extrapolateRight: "clamp",
      });
      const opacity = interpolate(absD, [0, 8], [0.75, 0], { extrapolateRight: "clamp" });
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "black",
            transform: `scale(${scale})`,
            opacity,
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      );
    }

    // Wipe: symmetric — outgoing scene covered by bar sliding in from left,
    // then bar slides out to left revealing incoming scene.
    if (transitionStyle === "wipe" && d >= -9 && d <= 18) {
      if (d < 0) {
        // Outgoing: black bar sweeps in from the left
        const progress = interpolate(d, [-9, 0], [0, 1], {
          easing: Easing.inOut(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const clipLeft = interpolate(progress, [0, 1], [100, 0]);
        return (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "black",
              clipPath: `inset(0 0 0 ${clipLeft}%)`,
              zIndex: 50,
              pointerEvents: "none",
            }}
          />
        );
      }
      // Incoming: black bar sweeps out to the right
      const progress = interpolate(d, [0, 18], [0, 1], {
        easing: Easing.inOut(Easing.cubic),
        extrapolateRight: "clamp",
      });
      const clipRight = interpolate(progress, [0, 1], [100, 0]);
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "black",
            clipPath: `inset(0 ${clipRight}% 0 0)`,
            zIndex: 50,
            pointerEvents: "none",
          }}
        />
      );
    }
  }

  return null;
}

export function ShortFormVideo(props: ShortFormVideoProps) {
  const {
    scenesWithTiming,
    scenes,
    resolvedAssets,
    audioResults,
    captionEntries,
    styleProfile,
    audioEnabled,
    musicUrl,
  } = props;
  const { colorStrategy, transitionStyle } = styleProfile;
  const vignette = colorStrategy.vignetteStrength ?? 0.55;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* Background music with real ducking envelope under narration */}
      {audioEnabled && musicUrl && (() => {
        // Build a per-frame volume function: 0.22 baseline, duck to 0.06 while
        // any scene has narration audio, with 6-frame linear ramps at boundaries.
        const MUSIC_BASE = 0.22;
        const MUSIC_DUCK = 0.06;
        const RAMP = 6;

        // Narration frames = all frames covered by a scene with real audio
        const narrationRanges = scenesWithTiming
          .map((swt, i) => ({ start: swt.startFrame, end: swt.startFrame + swt.durationFrames, hasAudio: audioResults[i]?.provider !== "silent" && !!audioResults[i]?.path }))
          .filter((r) => r.hasAudio);

        const volumeFn = (f: number) => {
          // Are we inside any narration range?
          const inNarration = narrationRanges.some((r) => f >= r.start && f < r.end);
          if (inNarration) return MUSIC_DUCK;

          // Ramp back up within RAMP frames after narration ends
          for (const r of narrationRanges) {
            if (f >= r.end && f < r.end + RAMP) {
              const t = (f - r.end) / RAMP;
              return MUSIC_DUCK + (MUSIC_BASE - MUSIC_DUCK) * t;
            }
            if (f >= r.start - RAMP && f < r.start) {
              const t = (r.start - f) / RAMP;
              return MUSIC_DUCK + (MUSIC_BASE - MUSIC_DUCK) * (1 - t);
            }
          }
          return MUSIC_BASE;
        };

        return (
          <Audio
            src={
              musicUrl.startsWith("file://") || musicUrl.startsWith("http")
                ? musicUrl
                : `file://${musicUrl}`
            }
            volume={volumeFn}
          />
        );
      })()}

      {scenesWithTiming.map((sceneWithTiming, i) => {
        const scene = scenes[i];
        const asset = resolvedAssets[i];
        const audio = audioResults[i];

        return (
          <Sequence
            key={scene.id}
            from={sceneWithTiming.startFrame}
            durationInFrames={sceneWithTiming.durationFrames}
          >
            {/* Background visual */}
            <SceneContent scene={scene} asset={asset} style={styleProfile} sceneIndex={i} />

            {/* Color tint overlay */}
            {colorStrategy.tint && <ColorTint tint={colorStrategy.tint} />}

            {/* Vignette */}
            <Vignette strength={vignette} />

            {/* Per-scene narration audio — convert absolute paths to file:// URLs */}
            {audioEnabled && audio?.path && audio.provider !== "silent" && (
              <Audio
                src={
                  audio.path.startsWith("file://") || audio.path.startsWith("http")
                    ? audio.path
                    : `file://${audio.path}`
                }
                volume={1.0}
              />
            )}
          </Sequence>
        );
      })}

      {/* Caption layer — always on top across all scenes */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 15,
          pointerEvents: "none",
        }}
      >
        <CaptionLayer captionEntries={captionEntries} style={styleProfile} />
      </div>

      {/* Silent TTS warning — visible in preview and first frames of render */}
      {audioEnabled &&
        audioResults.length > 0 &&
        audioResults.every((a) => a.provider === "silent" || !a.path) && (
          <div
            style={{
              position: "absolute",
              top: 36,
              left: 36,
              background: "#b91c1c",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 26,
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: 8,
              zIndex: 100,
              letterSpacing: 1,
              pointerEvents: "none",
            }}
          >
            ⚠ TTS SILENT — no narration audio
          </div>
        )}

      {/* Global transition layer — rendered outside Sequences so frame=0 is
          the composition start, not each scene start. This ensures outgoing
          transitions fire at scene end and incoming at scene start. */}
      <GlobalTransitionLayer
        scenesWithTiming={scenesWithTiming}
        transitionStyle={transitionStyle}
      />
    </div>
  );
}
