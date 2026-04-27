import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { VisualAsset, MotionStyle, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  asset: VisualAsset;
  motionStyle: MotionStyle;
  style?: StyleProfile;
}

export function ImageScene({ asset, motionStyle, style }: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = frame / durationInFrames;

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  let transform = "scale(1) translateX(0px) translateY(0px)";

  switch (motionStyle) {
    case "ken_burns": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.12], {
        easing: Easing.out(Easing.ease),
      });
      const tx = interpolate(progress, [0, 1], [0, -20]);
      transform = `scale(${scale}) translateX(${tx}px)`;
      break;
    }
    case "drift": {
      const tx = interpolate(progress, [0, 1], [0, 40], {
        easing: Easing.inOut(Easing.ease),
      });
      transform = `translateX(${tx}px)`;
      break;
    }
    case "zoom_in": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.2], {
        easing: Easing.out(Easing.ease),
      });
      transform = `scale(${scale})`;
      break;
    }
    case "parallax": {
      const ty = interpolate(progress, [0, 1], [0, -30]);
      transform = `translateY(${ty}px) scale(1.05)`;
      break;
    }
    case "static":
    default:
      transform = "scale(1)";
  }

  // Pick a usable source: real URL first, then the SVG fallback (data URL).
  // Without this fallback, demo-mode scenes whose visualMode is stockImage
  // render a black div because the SVG is in `svgData`, not `url`.
  const src = asset.url ?? asset.svgData;
  if (!src) return <div style={{ width: "100%", height: "100%", background: "#111" }} />;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        opacity: fadeIn,
      }}
    >
      <img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          transform,
          transformOrigin: "center center",
          // Style-driven film grade: brightness/contrast/saturate values come
          // from the active style preset's colorStrategy.imageFilter so 11
          // different photos share one tonal look across the cut.
          filter: style?.colorStrategy.imageFilter ?? undefined,
        }}
      />
    </div>
  );
}
