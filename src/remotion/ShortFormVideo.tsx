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

function SceneContent({
  scene,
  asset,
  style,
}: {
  scene: ScenePlan;
  asset: VisualAsset;
  style: StyleProfile;
}) {
  switch (asset.type) {
    case "stockVideo":
      return <VideoScene asset={asset} motionStyle={style.motionStyle} />;
    case "stockImage":
      return <ImageScene asset={asset} motionStyle={style.motionStyle} />;
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

function TransitionOverlay({
  transitionStyle,
}: {
  transitionStyle: string;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();

  if (transitionStyle === "fade") {
    const opacity = interpolate(frame, [0, 12], [1, 0], {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    });
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "black",
          opacity,
          zIndex: 20,
          pointerEvents: "none",
        }}
      />
    );
  }

  if (transitionStyle === "glitch") {
    if (frame > 6) return null;
    const tx = interpolate(frame, [0, 3, 6], [18, -9, 0]);
    const opacity = interpolate(frame, [0, 6], [0.85, 0]);
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "white",
          transform: `translateX(${tx}px)`,
          opacity,
          zIndex: 20,
          pointerEvents: "none",
        }}
      />
    );
  }

  if (transitionStyle === "zoom_through") {
    if (frame > 9) return null;
    const scale = interpolate(frame, [0, 9], [1.25, 1.0], {
      easing: Easing.out(Easing.ease),
    });
    const opacity = interpolate(frame, [0, 9], [0, 1], { extrapolateRight: "clamp" });
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${scale})`,
          opacity,
          zIndex: 20,
          pointerEvents: "none",
          background: "black",
        }}
      />
    );
  }

  // "cut" and "wipe" — just a very fast 4-frame fade on cut
  if (frame > 4) return null;
  const opacity = interpolate(frame, [0, 4], [0.6, 0]);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "black",
        opacity,
        zIndex: 20,
        pointerEvents: "none",
      }}
    />
  );
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
      {/* Background music — low volume ambient track under narration */}
      {audioEnabled && musicUrl && (
        <Audio
          src={
            musicUrl.startsWith("file://") || musicUrl.startsWith("http")
              ? musicUrl
              : `file://${musicUrl}`
          }
          volume={0.14}
        />
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

            {/* Transition effect */}
            <TransitionOverlay
              transitionStyle={transitionStyle}
              durationInFrames={sceneWithTiming.durationFrames}
            />

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
    </div>
  );
}
