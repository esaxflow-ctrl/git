import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { VisualAsset, StyleProfile } from "../../lib/validation/schemas";

interface Props {
  asset: VisualAsset;
  style: StyleProfile;
}

export function MotionCardScene({ asset, style }: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = frame / durationInFrames;

  // Subtle scale pulse for generated cards
  const scale = interpolate(progress, [0, 0.5, 1], [1.0, 1.02, 1.0], {
    easing: Easing.inOut(Easing.sin),
  });

  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  if (asset.svgData) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          transform: `scale(${scale})`,
          opacity,
          transformOrigin: "center center",
        }}
      >
        <img
          src={asset.svgData}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  // Fallback: solid color card with caption text
  const [bg] = style.colorStrategy.palette;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg ?? "#0a0a0a",
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    />
  );
}
