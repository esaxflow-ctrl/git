import { fetchPixabayMusic } from "./pixabay";

/**
 * Resolve a background music URL for the video.
 * Returns null if no API key is configured or the request fails.
 * Volume should be kept at 0.12–0.18 under narration.
 */
export async function resolveBackgroundMusic(mood: string): Promise<string | null> {
  const pixabayKey = process.env.PIXABAY_API_KEY;
  if (pixabayKey) {
    const url = await fetchPixabayMusic(mood, pixabayKey);
    if (url) return url;
  }
  // No music — render proceeds silently (narration only)
  return null;
}
