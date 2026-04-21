import {
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Audio,
  interpolate,
  Easing,
} from "remotion";
import { ShortFormVideoProps, VisualAsset, ScenePlan, StyleProfile } from "../lib/validation/schemas";
import { VideoScene } from "./scenes/VideoScene";
import { ImageScene } from "./scenes/ImageScene";
import { MotionCardScene } from "./scenes/MotionCardScene";
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
    case "textCard":
    case "gradientMotionCard":
    case "evidenceCard":
    case "mapCard":
    case "timelineCard":
      return <MotionCardScene asset={asset} style={style} />;
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
        background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${strength}) 100%)`,
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
  durationInFrames,
}: {
  transitionStyle: string;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();

  if (transitionStyle === "fade") {
    // Fade in at start
    const opacity = interpolate(frame, [0, 10], [1, 0], {
      extrapolateRight: "clamp",
      easing: Easing.ease,
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
    if (frame > 5) return null;
    const tx = interpolate(frame, [0, 3, 5], [20, -10, 0]);
    const opacity = interpolate(frame, [0, 5], [0.8, 0]);
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
    if (frame > 8) return null;
    const scale = interpolate(frame, [0, 8], [1.3, 1.0], {
      easing: Easing.out(Easing.ease),
    });
    const opacity = interpolate(frame, [0, 8], [0, 1], {
      extrapolateRight: "clamp",
    });
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

  return null;
}

export function ShortFormVideo(props: ShortFormVideoProps) {
  const { scenesWithTiming, scenes, resolvedAssets, audioResults, captionEntries, styleProfile, audioEnabled } = props;
  const { colorStrategy, transitionStyle } = styleProfile;
  const vignette = colorStrategy.vignetteStrength ?? 0.5;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "#000" }}>
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

            {/* Audio */}
            {audioEnabled && audio?.path && audio.provider !== "silent" && (
              <Audio src={audio.path} />
            )}
          </Sequence>
        );
      })}

      {/* Caption layer — always on top across all scenes */}
      <div style={{ position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none" }}>
        <CaptionLayer captionEntries={captionEntries} style={styleProfile} />
      </div>
    </div>
  );
}
