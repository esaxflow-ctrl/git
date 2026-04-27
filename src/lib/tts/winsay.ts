// Windows SAPI TTS via PowerShell System.Speech.Synthesis.
//
// Last-resort voice when neither Kokoro nor Piper is available. Microsoft's
// built-in Zira / David voices ship on every Windows install since Win 7,
// so a Windows user always has SOME real voice instead of silent fallback.
//
// Audio quality is "Windows narrator" — flat and obviously synthetic, but
// it's a real voice with real word timings, which is enough to drive the
// caption layer and ship a watchable demo render.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { AudioResult, VoiceOptions } from "../validation/schemas";
import { estimateWordTimings } from "../captions";

const AUDIO_CACHE_DIR = path.join(process.env.CACHE_DIR ?? "/tmp/sfv-cache", "audio");

export function isWinSayAvailable(): boolean {
  if (process.platform !== "win32") return false;
  // PowerShell ships on every Windows ≥ 7. We don't probe at startup
  // because spawning powershell.exe just to check adds 1–2s; trust the
  // platform check.
  return true;
}

function getWavDurationMs(filePath: string): number {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 44) return Math.round((buffer.length / 32000) * 1000);
    const sampleRate = buffer.readUInt32LE(24);
    const byteRate = buffer.readUInt32LE(28);
    if (byteRate === 0) {
      return Math.round((buffer.length / (sampleRate * 2 || 32000)) * 1000);
    }
    const dataSize = buffer.length - 44;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return 0;
  }
}

export async function synthesizeWithWinSay(
  text: string,
  options: VoiceOptions
): Promise<AudioResult> {
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });

  const hash = crypto
    .createHash("md5")
    .update(`winsay::${text}::${options.voiceId}::${options.speed}`)
    .digest("hex");
  const outputPath = path.join(AUDIO_CACHE_DIR, `${hash}.wav`);

  if (!fs.existsSync(outputPath)) {
    // SAPI Rate is -10..10 (default 0). Map our 0.5x-2.0x speed to that.
    // 1.0 → 0, 1.5 → ~5, 2.0 → 10, 0.5 → -10. Approximate.
    const rate = Math.max(-10, Math.min(10, Math.round((options.speed - 1) * 10)));

    // Voice selection: voiceId may be "Zira", "David", or a full SAPI name.
    // Default to Zira because she's clearer than David at higher rates.
    const voiceHint = (options.voiceId ?? "Zira").toLowerCase();

    // Sanitize text for the inline PowerShell string (escape ' and `).
    const safeText = text.replace(/`/g, "``").replace(/'/g, "''");
    const safeOut = outputPath.replace(/'/g, "''");

    const ps = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled };
      $picked = $voices | Where-Object { $_.VoiceInfo.Name.ToLower().Contains('${voiceHint}') } | Select-Object -First 1;
      if ($picked) { $synth.SelectVoice($picked.VoiceInfo.Name); }
      $synth.Rate = ${rate};
      $synth.SetOutputToWaveFile('${safeOut}');
      $synth.Speak('${safeText}');
      $synth.Dispose();
    `.trim();

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve();
        } else {
          reject(new Error(`PowerShell SAPI exited ${code}: ${stderr.slice(0, 200)}`));
        }
      });
      // PowerShell on cold cache spawn ≈ 800ms + speech synthesis time.
      // 90 s ceiling covers a long script narration without false fail.
      setTimeout(() => proc.kill(), 90_000);
    });
  }

  const durationMs = getWavDurationMs(outputPath);
  const wordTimings = estimateWordTimings(text, durationMs);

  return {
    path: outputPath,
    durationMs,
    provider: "winsay",
    wordTimings,
  };
}
