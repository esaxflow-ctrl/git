import { useCurrentFrame, useVideoConfig, interpolate, Easing, Video, Img } from "remotion";
import { VisualAsset, MotionStyle, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  asset: VisualAsset;
  motionStyle: MotionStyle;
  style?: StyleProfile;
}

export function VideoScene({ asset, motionStyle, style }: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = frame / durationInFrames;

  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  let transform = "scale(1)";

  switch (motionStyle) {
    case "ken_burns": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.08], {
        easing: Easing.out(Easing.ease),
      });
      transform = `scale(${scale})`;
      break;
    }
    case "zoom_in": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.15]);
      transform = `scale(${scale})`;
      break;
    }
    case "drift": {
      const tx = interpolate(progress, [0, 1], [0, 20]);
      transform = `translateX(${tx}px)`;
      break;
    }
    default:
      transform = "scale(1)";
  }

  // Stock-video scene fell through to the SVG fallback (no Pexels key, etc.).
  // Render the SVG as a still image instead of a black void.
  if (!asset.url && asset.svgData) {
    return (
      <div style={{ width: "100%", height: "100%", overflow: "hidden", opacity: fadeIn }}>
        <Img
          src={asset.svgData}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform,
            transformOrigin: "center center",
          }}
        />
      </div>
    );
  }

  if (!asset.url) return <div style={{ width: "100%", height: "100%", background: "#000" }} />;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        opacity: fadeIn,
      }}
    >
      <Video
        src={asset.url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform,
          transformOrigin: "center center",
          filter: style?.colorStrategy.imageFilter ?? undefined,
        }}
        muted
      />
    </div>
  );
}
