import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { AudioResult, VoiceOptions } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

export function isPiperAvailable(): boolean {
  try {
    execSync("which piper", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function synthesizeWithPiper(
  text: string,
  options: VoiceOptions
): Promise<AudioResult> {
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  const hash = crypto
    .createHash("md5")
    .update(`piper::${text}::${options.voiceId}`)
    .digest("hex");

  const outputPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(outputPath)) {
    await new Promise<void>((resolve, reject) => {
      const args = ["--model", options.voiceId, "--output_file", outputPath];
      const proc = spawn("piper", args, { stdio: ["pipe", "ignore", "ignore"] });

      proc.stdin.write(text);
      proc.stdin.end();

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Piper exited with code ${code}`));
      });

      proc.on("error", reject);

      // Safety timeout
      setTimeout(() => {
        proc.kill();
        reject(new Error("Piper timed out after 30s"));
      }, 30000);
    });
  }

  const stats = fs.statSync(outputPath);
  // Rough WAV duration estimate: 32000 bytes/sec for 16kHz 16-bit mono
  const durationMs = Math.round((stats.size / 32000) * 1000);
  const wordTimings = estimateWordTimings(text, durationMs);

  return {
    path: outputPath,
    durationMs,
    provider: "piper",
    wordTimings,
  };
}
