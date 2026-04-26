# Short-Form Video System

Script → downloadable 1080×1920 MP4 with captions, scene-specific visuals, and optional narration. **Target: 60 seconds (locked to 58–62s).**

## What This Is Not

This is not a MediaRecorder browser export. Final rendering uses Remotion's `renderMedia()` server-side with Chromium workers. Duration is computed from actual audio timing and validated against the 58–62s band — never from browser clock drift.

It also is **not** an AI image/video generator. Visuals come from stock providers (Pexels / Pixabay / Openverse) plus a library of generated SVG motion-graphic cards. If you want diffusion-model imagery, you'll need to wire that in separately.

---

## Quick Start (Zero Paid APIs)

```bash
git clone <repo>
cd short-form-video-system
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. You can either:
- Use **Write Script** to generate a structured 60-second script (Hook / Setup / 3 points / Payoff / CTA), then **Generate Plan**, then **Render MP4**.
- Or paste your own script and click **Generate Plan**.

With no API keys set, the system uses:
- **Script writer**: deterministic 60s template (no LLM needed)
- **Planner**: deterministic sentence splitter (no LLM needed)
- **Visuals**: generated SVG motion graphics (no stock API needed)
- **Audio**: silent (produces a valid MP4 with estimated timing)

### Demo / dry-run mode

Forces every paid path off — deterministic planner, no Pexels/Pixabay/Openverse calls, silent TTS. Use this for end-to-end pipeline tests without spending API credits.

```bash
npm run dev:demo
```

That works on macOS, Linux, and Windows (via `cross-env`). If you'd rather set the env var by hand:

- macOS / Linux: `DEMO_MODE=1 npm run dev`
- Windows cmd: `set DEMO_MODE=1 && npm run dev`
- Windows PowerShell: `$env:DEMO_MODE="1"; npm run dev`

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Configure

Copy `.env.example` to `.env`. All values are optional — the system degrades gracefully.

```env
# Optional: local LLM for scene planning
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Optional: local TTS
KOKORO_BASE_URL=http://localhost:8880

# Optional: paid providers
PEXELS_API_KEY=your_key_here
PIXABAY_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

### 3. Run

Development (hot reload):
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

---

## Provider Fallback Chains

### Scene Planner
1. **Ollama** (local LLM, e.g. `mistral`) — best output, free, requires Ollama running
2. **OpenRouter** (cloud, free tier models) — requires `OPENROUTER_API_KEY`
3. **Deterministic** — always works, no dependencies, hard-codes anti-generic rules

### Visual Assets
1. **Pexels** — stock video + photo, requires `PEXELS_API_KEY`
2. **Pixabay** — stock photo, free tier without key
3. **Generated SVG** — always works, 8 template types, no dependencies

### Text-to-Speech
1. **Kokoro** (local, OpenAI-compatible API) — run at `localhost:8880`
2. **Piper** (local subprocess) — if `piper` binary in PATH
3. **Silent** — renders valid MP4 with estimated timing

---

## Setting Up Local Providers

### Ollama (Scene Planning)

```bash
# Install Ollama: https://ollama.ai
ollama pull mistral
ollama serve
```

The planner sends a structured JSON prompt and validates the response with Zod. Falls through to deterministic splitter if Ollama returns invalid output.

### Kokoro TTS (Narration)

```bash
# Run Kokoro with its Docker image:
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
# Or GPU version for faster synthesis
```

Kokoro exposes an OpenAI-compatible `/v1/audio/speech` endpoint. The system requests WAV output and reads duration directly from the WAV header.

### Piper TTS (Alternative)

```bash
# Install Piper: https://github.com/rhasspy/piper
# Download a voice model, then:
echo "Your text here" | piper --model en_US-lessac-medium --output_file out.wav
```

Set the voice ID to the model path when using Piper.

---

## Plugging In Paid Providers

### Pexels (Stock Video + Photo)

1. Get a free API key at https://www.pexels.com/api/
2. Add to `.env`: `PEXELS_API_KEY=your_key`
3. Stock video and portrait photos are now used when `visualMode` is `stockVideo` or `stockImage`

### Pixabay (Stock Photo)

1. Register at https://pixabay.com/api/docs/
2. Add to `.env`: `PIXABAY_API_KEY=your_key`
3. Used as fallback when Pexels is unavailable or mode is image-only

### OpenRouter (Cloud LLM Planning)

1. Get a key at https://openrouter.ai
2. Add to `.env`: `OPENROUTER_API_KEY=your_key`
3. Default model: `mistralai/mistral-7b-instruct:free` (free tier)
4. Override: `OPENROUTER_MODEL=anthropic/claude-3-haiku` (paid)

---

## Style Presets

| ID | Tone | Caption | Motion | Use for |
|---|---|---|---|---|
| `dark_cinematic` | intense, filmic | phrase_slide | ken_burns | drama, thriller, mystery |
| `documentary` | measured, factual | karaoke | drift | explainers, history |
| `internet_mystery` | conspiratorial | word_pop | zoom_in | "you won't believe" content |
| `finance_news` | sharp, urgent | typewriter | static | markets, news, data |
| `horror_story` | dread, slow burn | phrase_slide | drift | horror, creepypasta |
| `motivational` | energetic, bold | word_pop | zoom_in | self-improvement, sports |
| `sports_commentary` | high energy | karaoke | ken_burns | sports, highlights |

Each preset differs in caption animation, motion style, transition, color palette, and pacing rules. The system enforces at least 3 distinct visual modes across any video rendered with these presets.

---

## Anti-Generic Safeguards

The system actively rejects low-quality, repetitive output:

**Hard errors** (trigger retry/fallback):
- Any visual mode used in >60% of scenes
- Search terms on the generic blocklist (`"nature"`, `"city"`, `"people"`, etc.)
- Fewer than 3 distinct visual roles across all scenes

**Warnings** (shown in UI, non-fatal):
- Consecutive scenes sharing the same mode and search terms
- All scenes with identical pacing

The deterministic fallback hard-codes diversity: round-robin visual modes, position-based visual roles, alternating pacing patterns.

---

## Architecture

```
Browser (React/Vite)
  └── POST /api/script/generate → generateScript() → [Ollama|OpenRouter|Deterministic]
  └── POST /api/script/validate → length/hook/originality gate
  └── POST /api/plan          → generateScenes() → [Ollama|OpenRouter|Deterministic]
  └── POST /api/resolve-visuals → resolveVisual() → [Pexels|Pixabay|Openverse|Generated SVG]
  └── POST /api/synthesize    → synthesizeScenes() → [Kokoro|Piper|macOS say|Silent]
  └── POST /api/render        → starts Remotion renderMedia() in background
  └── GET  /api/render/:id/status  → SSE progress stream
  └── GET  /api/render/:id/report  → JSON debug report (durations, fallbacks, validation)
  └── GET  /api/download/:id  → streams MP4
  └── GET  /api/download/:id/srt → generates + streams SRT

Node Server (Express)
  └── All API keys read from process.env (never sent to client)
  └── File cache: /tmp/sfv-cache/{plans,visuals,audio}

Remotion Renderer (server-side)
  └── bundle() → creates webpack bundle of src/remotion/Root.tsx
  └── renderMedia() → spawns Chromium workers, renders 30fps frames
  └── Codec: H.264, 1080×1920, output to /tmp/sfv-output/{jobId}.mp4
```

**No MediaRecorder.** The render is fully server-side. Duration is exact.

---

## Sample Script

The sample below produces a valid MP4 with the `documentary` preset and zero API keys:

```
In 1969, NASA landed humans on the moon using computers less powerful than a modern calculator.

The Apollo Guidance Computer had just 4 kilobytes of RAM and ran at 0.043 MHz. Your smartphone is literally a million times more powerful.

But here's the thing nobody talks about: it wasn't the hardware that got them there. It was the software — 145,000 lines of hand-coded assembly, written mostly by women.

Margaret Hamilton, the lead developer, coined the term "software engineering" to give her team's work the respect it deserved.

The code was so reliable it had zero crashes during the entire mission. Zero. That's a standard we still haven't matched today.
```

Expected output: 4–6 scenes, ~55–65 seconds, varied visual modes (gradientMotionCard, evidenceCard, textCard, quoteCard), readable captions, valid MP4.

---

## What Was Removed (vs the Failed Prototype)

The previous prototype used **browser MediaRecorder** to capture a canvas. This approach was discarded entirely because:

1. **Timing drift**: MediaRecorder captures real-time. If the browser renders a frame late (garbage collection, tab switching, CPU spike), that lag is baked into the video. A 60-second video could render as 58 or 64 seconds.
2. **No server control**: The browser can't read audio files from disk, can't run ffmpeg, can't produce reliable H.264.
3. **Tab-dependent**: The tab had to stay open and in focus during export. Any interruption corrupted the output.
4. **No real captions**: Browser canvas `fillText` can't produce the animated, styled, synced captions Remotion achieves.

**Replacement**: Remotion `renderMedia()` runs in Node.js, spawns headless Chromium workers, renders every frame deterministically, and produces a standards-compliant H.264 MP4 with exact duration.

---

## File Structure

```
src/
├── lib/validation/schemas.ts      # All Zod schemas — single source of truth
├── lib/validation/antiGeneric.ts  # Originality enforcement
├── lib/script/                    # 60s script writer + structural validator
├── lib/styleProfiles/             # 7 built-in style presets
├── lib/planner/                   # Scene planning (Ollama → OpenRouter → Deterministic)
├── lib/assets/                    # Visual resolution (Pexels → Pixabay → Openverse → SVG)
├── lib/tts/                       # TTS (Kokoro w/ retry → Piper → macOS → Silent)
├── lib/captions/                  # Caption timing + SRT export
├── lib/qualityGate.ts             # 7-dimension slop detector (1–10 score)
├── lib/cache/                     # File-based cache (MD5 key, TTL)
├── remotion/                      # Remotion compositions (1080×1920, 30fps)
│   ├── Root.tsx
│   ├── ShortFormVideo.tsx
│   ├── scenes/                    # VideoScene, ImageScene, MotionCardScene, etc.
│   └── captions/CaptionLayer.tsx
├── server/
│   ├── routes/                    # plan, script, assets, tts, render, download, styles
│   └── render/
│       ├── remotionRender.ts      # bundle() + renderMedia() + 60s enforcer
│       ├── exportValidator.ts     # final-MP4 validator (duration / size / codec)
│       └── debugReport.ts         # per-job JSON report writer
├── api/client.ts                  # Typed fetch wrappers (client-side)
└── components/                    # React UI components
```

---

## 60-Second Timing Engine

`computeSceneDurations()` in `src/server/render/remotionRender.ts`:

1. When real audio is available, **the audio drives scene duration** (audio + small padding). Scene-level pacing caps are no longer applied to real audio — that bug previously truncated voiceover.
2. For silent / estimated scenes, the style preset's `pacingRules.minSceneDurationMs` and `maxSceneDurationMs` apply.
3. After per-scene durations are computed, `enforceTotalDuration()` ensures the timeline lands in **58–62 s**:
   - If the total is below 58 s → the last scene is padded to reach 60 s.
   - If the total is above 62 s → all scenes are scaled down proportionally to 60 s. (Long overruns mean the script was too long; the script validator catches that earlier.)

After render, `validateExport()` reads the actual MP4 with `getVideoMetadata` and confirms duration ∈ [58, 62] s, resolution = 1080×1920, an audio track exists when audio was enabled, and the file is non-trivially sized. If validation fails, the job moves to `error` and the failures are listed in the debug report.

---

## Debug Reports

Every render writes `OUTPUT_DIR/{jobId}.report.json` with:

- script word count
- total voiceover duration (ms)
- final video duration (s)
- scene count, caption count, visual asset count
- visual assets grouped by provider
- TTS providers used
- which fallbacks fired (SVG card, silent audio, etc.)
- the full export validation result

You can also fetch it over HTTP at `GET /api/render/{jobId}/report`.

---

## Debugging Failed Renders

1. **Check the debug report** at `OUTPUT_DIR/{jobId}.report.json` (or `GET /api/render/{jobId}/report`). The `validation.failures` array tells you exactly what went wrong.
2. **Look at the server console** — `[render:<jobId>]`, `[tts:kokoro]`, `[planner:*]`, `[assets:*]` lines all log fallback events with input summaries.
3. **Common failure modes:**
   - "Duration X.XXs is below 58s floor" → script too short. Run `/api/script/validate` first; aim for 135–165 words.
   - "Output has no audio track" → Kokoro is unreachable or returned non-WAV. Check `KOKORO_BASE_URL`. Retries (3×, exponential backoff) are already on.
   - "No visual asset resolved" → Pexels/Pixabay key invalid + Openverse offline. The SVG fallback should always rescue, so this only fires when the asset cache is corrupted.
4. **Re-run with `DEMO_MODE=1`** to remove every external call from the equation. If demo mode renders cleanly, the issue is provider config; if it doesn't, the issue is in the render pipeline.

---

## Known Limitations

- **No AI image / video generation.** Visuals are stock + generated SVG. Add a diffusion provider yourself if you need it.
- **Caption word timings are estimated**, not forced-aligned. Sync is good but not phoneme-exact. Plug in `whisper.cpp` for forced alignment if you need broadcast-grade accuracy.
- **Voice quality depends on Kokoro / Piper.** Without one of those running, the system is silent. ElevenLabs / OpenAI TTS adapters are not wired up.
- **Single-user, in-memory job store.** Jobs do not survive a server restart. Fine for a local tool; not production-ready for multi-user.
