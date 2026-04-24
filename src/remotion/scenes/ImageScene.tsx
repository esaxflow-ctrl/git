import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import { VisualAsset, MotionStyle } from "../../lib/validation/schemas";

type PanDirection = "right" | "left" | "up" | "down";

interface Props {
  asset: VisualAsset;
  motionStyle: MotionStyle;
  // 0.0 (barely moves) → 1.0 (full amplitude). Defaults to 0.75.
  amplitude?: number;
  // Pan direction for ken_burns and drift. Varies per scene so adjacent
  // scenes never pan the same way.
  direction?: PanDirection;
}

export function ImageScene({
  asset,
  motionStyle,
  amplitude = 0.75,
  direction = "right",
}: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = frame / durationInFrames;
  const amp = Math.max(0, Math.min(1, amplitude));

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  let transform = "scale(1) translate(0px, 0px)";

  // Directional offsets scaled by amplitude
  const panPx = amp * 24;
  const zoomTarget = 1.0 + 0.18 * amp;

  switch (motionStyle) {
    case "ken_burns": {
      const scale = interpolate(progress, [0, 1], [1.0, 1.0 + 0.12 * amp], {
        easing: Easing.out(Easing.ease),
      });
      const tx =
        direction === "right"
          ? interpolate(progress, [0, 1], [0, -panPx])
          : direction === "left"
          ? interpolate(progress, [0, 1], [0, panPx])
          : 0;
      const ty =
        direction === "up"
          ? interpolate(progress, [0, 1], [0, panPx * 0.6])
          : direction === "down"
          ? interpolate(progress, [0, 1], [0, -panPx * 0.6])
          : 0;
      transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
      break;
    }
    case "drift": {
      const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
      const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
      const dist = amp * 8;
      const tx = interpolate(progress, [0, 1], [0, dx * dist], {
        easing: Easing.inOut(Easing.ease),
      });
      const ty = interpolate(progress, [0, 1], [0, dy * dist], {
        easing: Easing.inOut(Easing.ease),
      });
      transform = `translate(${tx}px, ${ty}px)`;
      break;
    }
    case "zoom_in": {
      const scale = interpolate(progress, [0, 1], [1.0, zoomTarget], {
        easing: Easing.out(Easing.ease),
      });
      transform = `scale(${scale})`;
      break;
    }
    case "parallax": {
      const dy =
        direction === "up" || direction === "right"
          ? interpolate(progress, [0, 1], [0, -amp * 30])
          : interpolate(progress, [0, 1], [0, amp * 30]);
      transform = `translateY(${dy}px) scale(${1.0 + 0.05 * amp})`;
      break;
    }
    case "static":
    default:
      transform = "scale(1)";
  }

  if (!asset.url) return <div style={{ width: "100%", height: "100%", background: "#111" }} />;

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
        src={asset.url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center",
          transform,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
