import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AudioResult, VoiceOptions } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const KOKORO_BASE_URL = process.env.KOKORO_BASE_URL ?? "http://localhost:8880";
const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

export async function isKokoroAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${KOKORO_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function synthesizeWithKokoro(
  text: string,
  options: VoiceOptions
): Promise<AudioResult> {
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  const hash = crypto
    .createHash("md5")
    .update(`${text}::${options.voiceId}::${options.speed}`)
    .digest("hex");

  const outputPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(outputPath)) {
    const res = await fetch(`${KOKORO_BASE_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice: options.voiceId,
        response_format: "wav",
        speed: options.speed,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      throw new Error(`Kokoro returned ${res.status}: ${await res.text()}`);
    }

    const buffer = await res.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));
  }

  const durationMs = await getWavDurationMs(outputPath);
  const wordTimings = estimateWordTimings(text, durationMs);

  return {
    path: outputPath,
    durationMs,
    provider: "kokoro",
    wordTimings,
  };
}

function getWavDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      const buffer = fs.readFileSync(filePath);
      // WAV header: bytes 24-27 = sample rate, bytes 28-31 = byte rate
      // bytes 4-7 = file size - 8, data chunk starts after header
      if (buffer.length < 44) {
        resolve(estimateDurationFromSize(buffer.length));
        return;
      }
      const sampleRate = buffer.readUInt32LE(24);
      const byteRate = buffer.readUInt32LE(28);
      if (byteRate === 0) {
        resolve(estimateDurationFromSize(buffer.length));
        return;
      }
      // Data size = total file - 44 byte header
      const dataSize = buffer.length - 44;
      const durationSeconds = dataSize / byteRate;
      resolve(Math.round(durationSeconds * 1000));
    } catch (err) {
      reject(err);
    }
  });
}

function estimateDurationFromSize(bytes: number): number {
  // Rough estimate: 16kHz 16-bit mono WAV = 32000 bytes/sec
  return Math.round((bytes / 32000) * 1000);
}
