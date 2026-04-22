import crypto from "crypto";

const PIXABAY_BASE = "https://pixabay.com/api/";

interface PixabayMusicHit {
  id: number;
  tags: string;
  previewURL: string;
  duration: number;
}

interface PixabayMusicResponse {
  totalHits: number;
  hits: PixabayMusicHit[];
}

// Maps mood keywords to ambient music search queries
const MOOD_MUSIC_QUERIES: Record<string, string> = {
  anxious: "ambient suspense",
  tense: "ambient suspense",
  dramatic: "cinematic dramatic",
  hopeful: "ambient uplifting",
  contemplative: "ambient calm",
  motivational: "upbeat motivational",
  melancholy: "ambient sad",
  dark: "dark ambient",
  urgent: "cinematic tense",
  calm: "ambient relaxing",
};

function moodToQuery(mood: string): string {
  const lower = mood.toLowerCase();
  for (const [key, query] of Object.entries(MOOD_MUSIC_QUERIES)) {
    if (lower.includes(key)) return query;
  }
  return "ambient background";
}

function deterministicPick(seed: string, max: number): number {
  const hash = crypto.createHash("md5").update(seed).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % max;
}

export async function fetchPixabayMusic(
  mood: string,
  apiKey: string
): Promise<string | null> {
  const query = moodToQuery(mood);

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    media_type: "music",
    per_page: "20",
  });

  try {
    const res = await fetch(`${PIXABAY_BASE}?${params.toString()}`, {
      headers: { "User-Agent": "ShortFormVideoSystem/1.0" },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) throw new Error(`Pixabay music ${res.status}`);

    const data = (await res.json()) as PixabayMusicResponse;
    if (!data.hits || data.hits.length === 0) return null;

    const idx = deterministicPick(mood + query, data.hits.length);
    const hit = data.hits[idx];

    return hit.previewURL ?? null;
  } catch (err) {
    console.warn(`[music:pixabay] ${err}`);
    return null;
  }
}
