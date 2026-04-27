// LLM JSON repair + schema coercion.
//
// Small local models (llama3.2:3b, phi3, mistral 7b q4) routinely produce
// JSON with these mistakes:
//   - trailing commas before `]` or `}`
//   - "smart quotes" instead of straight quotes
//   - // line comments outside strings
//   - emphasisWords / searchTerms returned as a single space-separated
//     string instead of the array the schema demands
//   - missing commas between objects
//
// We do best-effort repair before strict validation so a tiny model isn't
// a dealbreaker. Each repair runs on the raw text or a parsed object, then
// the consumer hands the result to Zod.

export interface JsonExtractOptions {
  expect: "array" | "object";
}

export function extractJsonBlock(text: string, opts: JsonExtractOptions): string {
  const open = opts.expect === "array" ? "[" : "{";
  const close = opts.expect === "array" ? "]" : "}";
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON ${opts.expect} found in LLM response`);
  }
  return text.slice(start, end + 1);
}

// Common LLM JSON mistakes — applied pre-parse.
export function repairJsonText(raw: string): string {
  let s = raw;

  // 1. Strip line comments (// ...) outside strings.
  // Cheap heuristic: only strip if the // is preceded by whitespace or
  // a comma/bracket — won't perfectly handle URLs in strings but the
  // planner prompt doesn't ask for URLs.
  s = s.replace(/(^|[\s,\[{])\/\/[^\n]*/g, "$1");

  // 2. Strip /* block comments */
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");

  // 3. Replace smart quotes with straight quotes.
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  // 4. Trailing commas before ] or }.
  s = s.replace(/,(\s*[\]}])/g, "$1");

  // 5. Missing comma between adjacent objects: }{ → },{ and ]{...→ ],{...
  s = s.replace(/}(\s*){/g, "},$1{");

  return s;
}

// Coerce a value that should be an array of strings.
// Handles: real array (passes through), space-separated string,
// comma-separated string, single string (wrapped).
export function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    if (value.includes(",")) {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (value.trim().length === 0) return [];
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

// Walk a parsed scene-plan object and fix the most common type mismatches.
// Mutates and returns the value.
//
// Fields that local LLMs flatten to strings: emphasisWords, searchTerms.
// Fields that local LLMs sometimes wrap in arrays when they should be
// strings: caption, narration, mood (rare, included for safety).
export function coerceScenePlanShape(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const arr = Array.isArray(value) ? value : [value];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if ("emphasisWords" in obj) obj.emphasisWords = coerceStringArray(obj.emphasisWords);
    if ("searchTerms" in obj) obj.searchTerms = coerceStringArray(obj.searchTerms);
    for (const stringField of ["caption", "narration", "mood", "sceneGoal", "id"]) {
      const v = obj[stringField];
      if (Array.isArray(v)) obj[stringField] = (v as unknown[]).map(String).join(" ");
    }
    // durationHint sometimes returns a string like "8" — coerce.
    if (typeof obj.durationHint === "string") {
      const n = Number(obj.durationHint);
      if (!Number.isNaN(n)) obj.durationHint = n;
    }
  }
  return Array.isArray(value) ? arr : arr[0];
}

// Combined helper: extract → repair → parse → coerce.
export function parseLlmJson<T = unknown>(
  raw: string,
  expect: "array" | "object",
  coerce?: (v: unknown) => unknown
): T {
  const block = extractJsonBlock(raw, { expect });
  const repaired = repairJsonText(block);
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch (err) {
    // One more attempt: aggressively strip trailing content after the last
    // closing brace/bracket that matches the expected outer shape.
    const trimmed = repaired.replace(/[^\s,\]}]+$/g, "");
    parsed = JSON.parse(trimmed);
    if (parsed === undefined) throw err;
  }
  const coerced = coerce ? coerce(parsed) : parsed;
  return coerced as T;
}
