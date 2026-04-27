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
import { VideoScene } from "./scenes/VideoScene";
import { ImageScene } from "./scenes/ImageScene";
import { GradientMotionCardScene } from "./scenes/GradientMotionCardScene";
import { TextCardScene } from "./scenes/TextCardScene";
import { EvidenceCardScene } from "./scenes/EvidenceCardScene";
import { TimelineCardScene } from "./scenes/TimelineCardScene";
import { KineticTextScene } from "./scenes/KineticTextScene";
import { QuoteCardScene } from "./scenes/QuoteCardScene";
import { CaptionLayer } from "./captions/CaptionLayer";

// Role + pacing → override base motion style for stronger cinematic language
function effectiveMotion(
  base: MotionStyle,
  role: VisualRole | undefined,
  pacing: PacingMode | undefined
): MotionStyle {
  if (role === "hook" && (pacing === "fast" || pacing === "medium")) return "zoom_in";
  if (role === "climax") return "ken_burns";
  if (role === "resolution") return "ken_burns";
  if (role === "evidence" && pacing === "dramatic_pause") return "drift";
  if (pacing === "fast") return "zoom_in";
  if (pacing === "slow") return "ken_burns";
  return base;
}

function SceneContent({
  scene,
  asset,
  style,
}: {
  scene: ScenePlan;
  asset: VisualAsset;
  style: StyleProfile;
}) {
  const motion = effectiveMotion(style.motionStyle, scene.visualRole, scene.pacing);
  switch (asset.type) {
    case "stockVideo":
      return <VideoScene asset={asset} motionStyle={motion} style={style} />;
    case "stockImage":
      return <ImageScene asset={asset} motionStyle={motion} style={style} />;
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

    if (transitionStyle === "fade" && d >= -6 && d <= 8) {
      // Soft fade — peak opacity 0.35 instead of 0.92 so the cut feels
      // like a brief darken-then-reveal, not a fade-to-black-and-back.
      // Modern short-form viewers read full-black as "dead frame" and
      // bounce; a subtle dim is enough to mark the boundary.
      const opacity =
        d < 0
          ? interpolate(d, [-6, 0], [0, 0.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          : interpolate(d, [0, 8], [0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
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

    // Wipe: a thin accent stripe sweeps right-to-left across the frame
    // instead of a full black bar. The old version showed half the frame
    // as solid black mid-transition, which read as a "dead frame" black
    // flash on short-form players.
    if (transitionStyle === "wipe" && d >= 0 && d <= 14) {
      const progress = interpolate(d, [0, 14], [0, 1], {
        easing: Easing.inOut(Easing.cubic),
        extrapolateRight: "clamp",
      });
      const stripeLeft = interpolate(progress, [0, 1], [100, -10]);
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${stripeLeft}%`,
              width: "8%",
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)",
            }}
          />
        </div>
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
      {/* Background music — low volume ambient track under narration.
          buildInputProps already rewrote local paths to http://localhost
          /audio-cache URLs so Remotion can fetch them. */}
      {audioEnabled && musicUrl && musicUrl.startsWith("http") && (
        <Audio src={musicUrl} volume={0.14} />
      )}

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
            <SceneContent scene={scene} asset={asset} style={styleProfile} />

            {/* Color tint overlay */}
            {colorStrategy.tint && <ColorTint tint={colorStrategy.tint} />}

            {/* Vignette */}
            <Vignette strength={vignette} />

            {/* Per-scene narration audio. buildInputProps already mapped
                local paths to http://localhost/audio-cache URLs. */}
            {audioEnabled && audio?.path && audio.provider !== "silent" && audio.path.startsWith("http") && (
              <Audio src={audio.path} volume={1.0} />
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
