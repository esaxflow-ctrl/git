import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AudioResult } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const execFileAsync = promisify(execFile);
const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

let availableVoicesCache: string[] | null = null;

async function getAvailableVoices(): Promise<string[]> {
  if (availableVoicesCache) return availableVoicesCache;
  try {
    const { stdout } = await execFileAsync("say", ["-v", "?"], { timeout: 5_000 });
    // Format: "Samantha       en_US    # Hi! My name is Samantha."
    availableVoicesCache = stdout
      .split("\n")
      .map((l) => l.split(/\s+/)[0])
      .filter((v) => v && v.length > 0);
    return availableVoicesCache;
  } catch {
    availableVoicesCache = [];
    return [];
  }
}

async function pickVoice(preferred?: string): Promise<string | null> {
  const voices = await getAvailableVoices();
  if (voices.length === 0) return null;

  if (preferred && voices.includes(preferred)) return preferred;

  // Prefer high-quality English voices if installed, else fall back to any English voice
  const preferred_order = ["Samantha", "Ava", "Allison", "Tom", "Alex", "Victoria", "Evan", "Fred"];
  for (const v of preferred_order) {
    if (voices.includes(v)) return v;
  }
  // Last resort: any voice starting with a capital letter (valid named voice)
  const anyNamed = voices.find((v) => /^[A-Z]/.test(v));
  return anyNamed ?? voices[0] ?? null;
}

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

  const voice = await pickVoice(preferredVoice);
  const hash = crypto
    .createHash("md5")
    .update(`macos_say::${voice ?? "default"}::${text}`)
    .digest("hex");

  const aiffPath = path.join(AUDIO_CACHE_DIR, `${hash}.aiff`);
  const wavPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(wavPath)) {
    // Build args — if voice lookup failed, call `say` without -v (uses system default)
    const sayArgs = voice
      ? ["-v", voice, "-o", aiffPath, "--", text]
      : ["-o", aiffPath, "--", text];

    await execFileAsync("say", sayArgs, { timeout: 120_000 });

    // Verify AIFF was actually written with content
    if (!fs.existsSync(aiffPath)) {
      throw new Error(`say produced no output file (voice: ${voice ?? "default"})`);
    }
    const aiffSize = fs.statSync(aiffPath).size;
    if (aiffSize < 1000) {
      try { fs.unlinkSync(aiffPath); } catch {}
      throw new Error(`say produced empty AIFF (${aiffSize} bytes, voice: ${voice ?? "default"})`);
    }

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
