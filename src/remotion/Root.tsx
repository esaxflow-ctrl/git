import { Composition, registerRoot } from "remotion";
import { ShortFormVideo } from "./ShortFormVideo";
import { ShortFormVideoProps } from "../lib/validation/schemas";

function RemotionRoot() {
  const defaultProps: ShortFormVideoProps = {
    scenes: [],
    scenesWithTiming: [],
    resolvedAssets: [],
    audioResults: [],
    captionEntries: [],
    styleProfile: {
      id: "dark_cinematic",
      name: "Dark Cinematic",
      tone: "intense",
      captionStyle: {
        fontFamily: "Georgia, serif",
        fontSize: 52,
        color: "#ffffff",
        highlightColor: "#e94560",
        animation: "phrase_slide",
        position: "bottom",
        maxWordsPerGroup: 4,
      },
      motionStyle: "ken_burns",
      transitionStyle: "fade",
      colorStrategy: {
        palette: ["#0a0a0a", "#1a1a2e", "#e94560"],
        overlayOpacity: 0.4,
        vignetteStrength: 0.7,
        tint: null,
      },
      narrationStyle: "dramatic",
      visualMixRules: {
        maxConsecutiveSameMode: 2,
        requiredModeVariation: 3,
        preferredModes: ["stockVideo", "stockImage", "quoteCard"],
      },
      pacingRules: {
        defaultPaddingMs: 800,
        audioPaddingMs: 400,
        minSceneDurationMs: 4000,
        maxSceneDurationMs: 14000,
      },
    },
    audioEnabled: false,
    totalFrames: 30 * 67,
  };

  return (
    <Composition
      id="ShortFormVideo"
      component={ShortFormVideo}
      durationInFrames={defaultProps.totalFrames}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: props.totalFrames,
      })}
    />
  );
}

registerRoot(RemotionRoot);
