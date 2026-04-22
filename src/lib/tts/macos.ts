import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AudioResult } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const execFileAsync = promisify(execFile);
const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

// macOS voices ordered by naturalness
const VOICE_PREFERENCE = ["Samantha", "Alex", "Tom", "Victoria"];

export function isMacosSayAvailable(): boolean {
  return process.platform === "darwin";
}

function getWavDurationMs(filePath: string): number {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 44) return 4000;
    const byteRate = buf.readUInt32LE(28);
    const dataSize = buf.readUInt32LE(40);
    if (byteRate === 0) return 4000;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return 4000;
  }
}

export async function synthesizeWithMacosSay(
  text: string,
  preferredVoice?: string
): Promise<AudioResult> {
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  const voice = preferredVoice ?? VOICE_PREFERENCE[0];
  const hash = crypto
    .createHash("md5")
    .update(`macos_say::${voice}::${text}`)
    .digest("hex");

  const aiffPath = path.join(AUDIO_CACHE_DIR, `${hash}.aiff`);
  const wavPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(wavPath)) {
    // say outputs AIFF natively on macOS
    await execFileAsync("say", ["-v", voice, "-o", aiffPath, "--", text], {
      timeout: 120_000,
    });

    // afconvert is built into macOS — converts AIFF → WAV (16-bit, 22050 Hz, mono)
    await execFileAsync(
      "afconvert",
      ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiffPath, wavPath],
      { timeout: 30_000 }
    );

    // Clean up intermediate AIFF
    try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
  }

  const durationMs = getWavDurationMs(wavPath);
  const wordTimings = estimateWordTimings(text, durationMs);

  return {
    path: wavPath,
    durationMs,
    provider: "macos_say",
    wordTimings,
  };
}
