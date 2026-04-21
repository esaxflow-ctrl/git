import { StyleProfile } from "../validation/schemas";
import { STYLE_PRESETS } from "./presets";

export const DEFAULT_STYLE_ID = "dark_cinematic";

export function getStyleProfile(id: string): StyleProfile {
  const profile = STYLE_PRESETS[id];
  if (!profile) {
    throw new Error(`Unknown style profile: "${id}". Available: ${Object.keys(STYLE_PRESETS).join(", ")}`);
  }
  return profile;
}

export function listStyleProfiles(): StyleProfile[] {
  return Object.values(STYLE_PRESETS);
}

export { STYLE_PRESETS };
