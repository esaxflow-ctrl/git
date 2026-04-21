import fs from "fs";
import path from "path";
import crypto from "crypto";

interface CacheMeta {
  key: string;
  createdAt: number;
  ttlHours: number;
}

export class FileCache<T> {
  private baseDir: string;
  private ttlHours: number;

  constructor(baseDir: string, ttlHours: number) {
    this.baseDir = baseDir;
    this.ttlHours = ttlHours;
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private keyToFilename(key: string): string {
    return crypto.createHash("md5").update(key).digest("hex");
  }

  private dataPath(filename: string): string {
    return path.join(this.baseDir, `${filename}.json`);
  }

  private metaPath(filename: string): string {
    return path.join(this.baseDir, `${filename}.meta.json`);
  }

  async get(key: string): Promise<T | null> {
    const filename = this.keyToFilename(key);
    const metaFile = this.metaPath(filename);
    const dataFile = this.dataPath(filename);

    if (!fs.existsSync(metaFile) || !fs.existsSync(dataFile)) {
      return null;
    }

    try {
      const meta: CacheMeta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      const ageHours = (Date.now() - meta.createdAt) / (1000 * 60 * 60);
      if (ageHours > meta.ttlHours) {
        fs.unlinkSync(metaFile);
        fs.unlinkSync(dataFile);
        return null;
      }
      const data: T = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      return data;
    } catch {
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const filename = this.keyToFilename(key);
    const meta: CacheMeta = { key, createdAt: Date.now(), ttlHours: this.ttlHours };
    fs.writeFileSync(this.metaPath(filename), JSON.stringify(meta));
    fs.writeFileSync(this.dataPath(filename), JSON.stringify(value));
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async evictExpired(): Promise<number> {
    let count = 0;
    const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith(".meta.json"));
    for (const file of files) {
      try {
        const meta: CacheMeta = JSON.parse(
          fs.readFileSync(path.join(this.baseDir, file), "utf-8")
        );
        const ageHours = (Date.now() - meta.createdAt) / (1000 * 60 * 60);
        if (ageHours > meta.ttlHours) {
          const base = file.replace(".meta.json", "");
          const dataFile = path.join(this.baseDir, `${base}.json`);
          fs.unlinkSync(path.join(this.baseDir, file));
          if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
          count++;
        }
      } catch {
        // corrupt meta, skip
      }
    }
    return count;
  }
}

const cacheDir = process.env.CACHE_DIR ?? "/tmp/sfv-cache";
const ttl = Number(process.env.CACHE_TTL_HOURS ?? 24);

export const planCache = new FileCache<unknown>(path.join(cacheDir, "plans"), ttl);
export const assetCache = new FileCache<unknown>(path.join(cacheDir, "visuals"), ttl);
export const audioCache = new FileCache<unknown>(path.join(cacheDir, "audio"), ttl);

export function planCacheKey(script: string, styleId: string): string {
  return `plan::${script}::${styleId}`;
}

export function assetCacheKey(searchTerms: string[], visualMode: string): string {
  return `asset::${searchTerms.slice().sort().join(",")}::${visualMode}`;
}

export function audioCacheKey(text: string, voiceId: string): string {
  return `audio::${text}::${voiceId}`;
}
