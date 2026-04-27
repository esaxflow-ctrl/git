import { AudioResult, VoiceOptions, ScenePlan } from "../validation/schemas";
import { audioCache, audioCacheKey } from "../cache";
import { isElevenLabsAvailable, synthesizeWithElevenLabs } from "./elevenlabs";
import { isKokoroAvailable, synthesizeWithKokoro } from "./kokoro";
import { isPiperAvailable, synthesizeWithPiper } from "./piper";
import { isMacosSayAvailable, synthesizeWithMacosSay } from "./macos";
import { isWinSayAvailable, synthesizeWithWinSay } from "./winsay";

export type TtsProvider = "kokoro" | "piper" | "macos_say" | "winsay" | "elevenlabs" | "silent";

export interface TtsResult {
  audioResults: AudioResult[];
  provider: TtsProvider;
}

const SILENT_RESULT: AudioResult = {
  path: "",
  durationMs: 0,
  provider: "silent",
  wordTimings: null,
};

function estimateSilentDuration(narration: string): number {
  const words = narration.split(/\s+/).length;
  return Math.max(4000, Math.min(15000, (words / 150) * 60 * 1000 + 800));
}

async function synthesizeOne(
  text: string,
  options: VoiceOptions,
  provider: TtsProvider
): Promise<AudioResult> {
  const cacheKey = audioCacheKey(text, `${provider}::${options.voiceId}::${options.speed}`);
  const cached = await audioCache.get(cacheKey);
  if (cached) return cached as AudioResult;

  let result: AudioResult;
  switch (provider) {
    case "kokoro":
      result = await synthesizeWithKokoro(text, options);
      break;
    case "piper":
      result = await synthesizeWithPiper(text, options);
      break;
    case "macos_say":
      result = await synthesizeWithMacosSay(text);
      break;
    case "winsay":
      result = await synthesizeWithWinSay(text, options);
      break;
    case "elevenlabs":
      result = await synthesizeWithElevenLabs(text, options);
      break;
    default:
      result = { ...SILENT_RESULT, durationMs: estimateSilentDuration(text) };
  }

  await audioCache.set(cacheKey, result);
  return result;
}

export async function synthesizeScenes(
  scenes: ScenePlan[],
  voiceOptions: Partial<VoiceOptions> = {}
): Promise<TtsResult> {
  const options: VoiceOptions = {
    voiceId: voiceOptions.voiceId ?? "af_sky",
    speed: voiceOptions.speed ?? 1.0,
  };

  let provider: TtsProvider = "silent";
  const demo = process.env.DEMO_MODE === "1";

  if (demo) {
    console.info("[tts] DEMO_MODE=1 — forcing silent fallback");
  } else if (isElevenLabsAvailable()) {
    // Best voice in the system — real-person realism. Counts against
    // the user's monthly char quota, so we honour DEMO_MODE skip above.
    provider = "elevenlabs";
  } else if (await isKokoroAvailable()) {
    provider = "kokoro";
  } else if (isPiperAvailable()) {
    provider = "piper";
  } else if (isMacosSayAvailable()) {
    provider = "macos_say";
  } else if (isWinSayAvailable()) {
    // Last-resort real voice on Windows. Quality is "Microsoft Narrator"
    // — flat but real speech, beats a silent video.
    provider = "winsay";
  }

  console.info(`[tts] Using provider: ${provider}`);

  const audioResults: AudioResult[] = [];

  for (const scene of scenes) {
    if (provider === "silent") {
      audioResults.push({
        ...SILENT_RESULT,
        durationMs: estimateSilentDuration(scene.narration),
      });
      continue;
    }

    try {
      const result = await synthesizeOne(scene.narration, options, provider);
      audioResults.push(result);
    } catch (err) {
      console.warn(`[tts] Failed for scene ${scene.id}: ${err}. Using silence.`);
      audioResults.push({
        ...SILENT_RESULT,
        durationMs: estimateSilentDuration(scene.narration),
      });
    }
  }

  return { audioResults, provider };
}
