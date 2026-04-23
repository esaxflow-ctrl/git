import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { stylesRouter } from "./routes/styles";
import { planRouter } from "./routes/plan";
import { assetsRouter } from "./routes/assets";
import { ttsRouter } from "./routes/tts";
import { renderRouter } from "./routes/render";
import { downloadRouter } from "./routes/download";
import { analyzeRouter } from "./routes/analyze";
import { planCache, assetCache, audioCache } from "../lib/cache";

const PORT = Number(process.env.PORT ?? 3001);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/tmp/sfv-output";

const app = express();

app.use(cors({ origin: ["http://localhost:3000", "http://localhost:5173"] }));
app.use(express.json({ limit: "5mb" }));

// API routes
app.use("/api/styles", stylesRouter);
app.use("/api/plan", planRouter);
app.use("/api", assetsRouter);
app.use("/api", ttsRouter);
app.use("/api/render", renderRouter);
app.use("/api/download", downloadRouter);
app.use("/api", analyzeRouter);

// Serve built frontend in production
const clientDist = path.join(process.cwd(), "dist", "client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Startup
async function start() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Evict stale cache entries
  const evicted = await Promise.all([
    planCache.evictExpired(),
    assetCache.evictExpired(),
    audioCache.evictExpired(),
  ]);
  console.info(`[cache] Evicted ${evicted.reduce((a, b) => a + b, 0)} stale entries`);

  app.listen(PORT, () => {
    console.info(`[server] Running on http://localhost:${PORT}`);
    console.info(`[server] Pexels API: ${process.env.PEXELS_API_KEY ? "✓" : "✗ (using generated graphics)"}`);
    console.info(`[server] Pixabay API: ${process.env.PIXABAY_API_KEY ? "✓" : "✗"}`);
    console.info(`[server] OpenRouter: ${process.env.OPENROUTER_API_KEY ? "✓" : "✗"}`);
    console.info(`[server] Ollama: ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}`);
    console.info(`[server] Kokoro TTS: ${process.env.KOKORO_BASE_URL ?? "http://localhost:8880"}`);
  });
}

start().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
