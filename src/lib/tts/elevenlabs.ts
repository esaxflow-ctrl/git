// ElevenLabs TTS adapter.
//
// Default of every TTS provider when an ELEVENLABS_API_KEY is set, since
// it produces the most realistic voice in the system. Free tier is 10K
// chars/month (~4 sixty-second scripts), Starter is $5/month for 30K
// chars. Voice IDs from the public default voice library are pre-mapped
// by name; the user can also drop a raw voice ID into ELEVENLABS_VOICE_ID
// to use a custom voice.
//
// Output: requests PCM 22.05 kHz mono 16-bit, then prepends a WAV header
// before writing to disk. This keeps duration measurement compatible with
// the existing WAV-header parser used by Kokoro/winsay.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AudioResult, VoiceOptions } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

// Public default voices — every account has access. User can override
// via ELEVENLABS_VOICE_ID with a custom voice ID from the dashboard.
const DEFAULT_VOICES: Record<string, string> = {
  rachel: "21m00Tcm4TlvDq8ikWAM",   // warm female (storytelling)
  adam: "pNInz6obpgDQGcFmaJgB",      // deep male (creator default)
  antoni: "ErXwobaYiN019PkySvjV",    // well-rounded male (explainer)
  bella: "EXAVITQu4vr4xnSDxMaL",     // soft female (calm)
  domi: "AZnzlk1XvdvUeBnXmlld",      // strong female
  elli: "MF3mGyEYCl7XYWbV9V6O",      // emotional female
  josh: "TxGEqnHWrfWFTfGW9XjX",      // deep male
  sam: "yoZ06aMxZJJ28mfd3POQ",       // raspy male
};

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

export function isElevenLabsAvailable(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function resolveVoiceId(voiceIdOrName?: string): string {
  const fromEnv = process.env.ELEVENLABS_VOICE_ID;
  const candidate = voiceIdOrName ?? fromEnv ?? "";
  if (!candidate) return DEFAULT_VOICE_ID;
  const known = DEFAULT_VOICES[candidate.toLowerCase()];
  if (known) return known;
  // Treat as raw 20-char voice ID.
  if (/^[A-Za-z0-9]{15,}$/.test(candidate)) return candidate;
  return DEFAULT_VOICE_ID;
}

// Build a 44-byte PCM WAV header for the given data length.
function buildWavHeader(
  pcmByteLength: number,
  sampleRate: number,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const buffer = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmByteLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmByteLength, 40);
  return buffer;
}

function getWavDurationMs(filePath: string): number {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 44) return 0;
    const byteRate = buffer.readUInt32LE(28);
    if (byteRate === 0) return 0;
    const dataSize = buffer.length - 44;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return 0;
  }
}

async function postElevenLabsWithRetry(
  text: string,
  voiceId: string,
  apiKey: string,
  speed: number
): Promise<ArrayBuffer> {
  const backoffMs = [800, 2400, 6000];
  let lastError: unknown = null;

  // ElevenLabs doesn't expose a direct speed parameter; voice settings
  // approximate it via stability + similarity_boost. We map our 0.5–2.0
  // range to those weights, but it's not a 1:1 conversion — for big
  // speed changes the user should pick a different model.
  const stability = Math.max(0.2, Math.min(0.9, 0.5 / Math.max(0.5, speed)));

  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const res = await fetch(
        `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}?output_format=pcm_22050`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/wav",
          },
          body: JSON.stringify({
            text,
            // eleven_turbo_v2_5 is the fastest realistic-quality model;
            // good balance of speed (cheaper) and audio quality.
            model_id: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5",
            voice_settings: {
              stability,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.arrayBuffer();
    } catch (err) {
      lastError = err;
      const wait = backoffMs[attempt];
      const summary =
        err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      if (wait === undefined) {
        console.warn(
          `[tts:elevenlabs] FAILED after ${attempt + 1} attempts (input ${text.length} chars, voice ${voiceId}): ${summary}`
        );
        break;
      }
      console.warn(
        `[tts:elevenlabs] attempt ${attempt + 1} failed: ${summary}. Retrying in ${wait}ms…`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`ElevenLabs failed: ${String(lastError)}`);
}

export async function synthesizeWithElevenLabs(
  text: string,
  options: VoiceOptions
): Promise<AudioResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  const voiceId = resolveVoiceId(options.voiceId);
  const hash = crypto
    .createHash("md5")
    .update(`elevenlabs::${text}::${voiceId}::${options.speed}`)
    .digest("hex");
  const outputPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(outputPath)) {
    const pcm = await postElevenLabsWithRetry(text, voiceId, apiKey, options.speed);
    const pcmBytes = Buffer.from(pcm);
    const header = buildWavHeader(pcmBytes.length, 22050);
    fs.writeFileSync(outputPath, Buffer.concat([header, pcmBytes]));
  }

  const durationMs = getWavDurationMs(outputPath);
  const wordTimings = estimateWordTimings(text, durationMs);

  return {
    path: outputPath,
    durationMs,
    provider: "elevenlabs",
    wordTimings,
  };
}
