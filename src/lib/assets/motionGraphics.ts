import { ScenePlan, StyleProfile, VisualAsset, VisualMode } from "../validation/schemas";
import crypto from "crypto";

function sceneHash(scene: ScenePlan): string {
  return crypto
    .createHash("md5")
    .update(scene.searchTerms.join(",") + scene.visualMode)
    .digest("hex")
    .slice(0, 8);
}

function escapeSvg(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

// Shared SVG defs: film grain noise filter + vignette
function sharedDefs(accent: string): string {
  return `<defs>
    <filter id="grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
      <feBlend in="SourceGraphic" in2="grayNoise" mode="overlay" result="blended"/>
      <feComposite in="blended" in2="SourceGraphic" operator="in"/>
    </filter>
    <radialGradient id="vig" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.72)"/>
    </radialGradient>
    <linearGradient id="fadeBottom" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.85)"/>
    </linearGradient>
    <marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4">
      <circle cx="5" cy="5" r="4" fill="${accent}"/>
    </marker>
  </defs>`;
}

// ─── Atmospheric gradient — TEXTLESS fallback when a photo can't be fetched ─
//
// Used when scene.visualMode is stockImage / stockVideo and every photo
// provider failed. Renders only colour atmosphere; the captions at the
// bottom of the frame carry the words. The seed varies the gradient angle
// + accent placement per scene so successive scenes don't look identical.

function atmosphericGradient(scene: ScenePlan, palette: string[]): string {
  const [bg1, bg2, accent] = palette;
  const seed = stringHash(scene.id);
  const angle = 110 + (seed % 80); // 110–190
  const accentX = 20 + (seed % 60); // 20–80%
  const accentY = 30 + ((seed >> 4) % 50); // 30–80%
  const accentR = 480 + (seed % 280); // 480–760

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(accent ?? "#ffffff")}
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%" gradientTransform="rotate(${angle - 135})">
      <stop offset="0%" stop-color="${bg1 ?? "#0a0a0a"}"/>
      <stop offset="60%" stop-color="${bg2 ?? "#1a1a2e"}"/>
      <stop offset="100%" stop-color="${bg1 ?? "#000"}"/>
    </linearGradient>
    <radialGradient id="accentGlow" cx="${accentX}%" cy="${accentY}%" r="50%">
      <stop offset="0%" stop-color="${accent ?? "#ffffff"}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${accent ?? "#ffffff"}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bgGrad)"/>
  <circle cx="${accentX * 10.8}" cy="${accentY * 19.2}" r="${accentR}" fill="url(#accentGlow)"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

function stringHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Cinematic gradient motion card — emotional opener / atmosphere ────────────

function gradientMotionCard(_scene: ScenePlan, palette: string[]): string {
  // No text leak — the on-screen caption layer carries the words. This card
  // is purely atmospheric: gradient backdrop + accent stripes.
  const [bg1, bg2, accent] = palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(accent ?? "#ffffff")}
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0%" stop-color="${bg1 ?? "#0a0a0a"}"/>
      <stop offset="55%" stop-color="${bg2 ?? bg1 ?? "#1a1a2e"}"/>
      <stop offset="100%" stop-color="${accent ?? bg1 ?? "#000"}" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bgGrad)"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
  <rect x="0" y="60" width="1080" height="2" fill="${accent ?? '#ffffff'}" opacity="0.18"/>
  <rect x="0" y="1860" width="1080" height="2" fill="${accent ?? '#ffffff'}" opacity="0.18"/>
  <rect width="1080" height="1920" fill="url(#vig)" opacity="0.15"/>
</svg>`;
}

// ─── Text card — movie title card / dramatic statement ────────────────────────

function textCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 14);
  const lineH = 118;
  const blockH = lines.length * lineH;
  const startY = (1920 - blockH) / 2;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="540" y="${startY + i * lineH + 90}" text-anchor="middle"
         font-size="106" font-weight="900" fill="white"
         font-family="Impact, 'Arial Black', sans-serif" letter-spacing="-2">${line}</text>`
    )
    .join("\n  ");

  const emphasisColor = accent ?? "#ffffff";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg}"/>
  <!-- Subtle grid lines for depth -->
  <line x1="0" y1="480" x2="1080" y2="480" stroke="white" stroke-width="1" opacity="0.04"/>
  <line x1="0" y1="960" x2="1080" y2="960" stroke="white" stroke-width="1" opacity="0.04"/>
  <line x1="0" y1="1440" x2="1080" y2="1440" stroke="white" stroke-width="1" opacity="0.04"/>
  <line x1="270" y1="0" x2="270" y2="1920" stroke="white" stroke-width="1" opacity="0.04"/>
  <line x1="810" y1="0" x2="810" y2="1920" stroke="white" stroke-width="1" opacity="0.04"/>
  <!-- Top accent rule -->
  <rect x="120" y="${startY - 40}" width="840" height="3" fill="${emphasisColor}" opacity="0.8"/>
  <!-- Main text -->
  ${textSvg}
  <!-- Bottom accent rule -->
  <rect x="120" y="${startY + blockH + 28}" width="840" height="3" fill="${emphasisColor}" opacity="0.8"/>
  <!-- Vignette -->
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

// ─── Quote card — minimal frame, no leaked attribution text ─────────────────
// Caption text comes from the global CaptionLayer; this card provides only
// the visual frame (backdrop + decorative quote marks).

function quoteCard(_scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const emphasisColor = accent ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg ?? "#0a0a0a"}"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
  <text x="120" y="640" font-size="320" fill="${emphasisColor}" opacity="0.10"
        font-family="Georgia, serif" font-weight="900">"</text>
  <text x="960" y="1380" font-size="320" fill="${emphasisColor}" opacity="0.10"
        font-family="Georgia, serif" font-weight="900" text-anchor="end">"</text>
</svg>`;
}

// ─── Evidence card — minimal frame, no leaked template metadata ─────────────
// Removed: "FINDING", scene-goal heading, giant ghost keyword, body-text
// duplicate of the caption, and the "SOURCE: OBSERVED BEHAVIOR PATTERN"
// placeholder. Caption layer carries all words.

function evidenceCard(_scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const emphasisColor = accent ?? "#e8e8e8";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg ?? "#0a0a0a"}"/>
  <rect x="0" y="0" width="1080" height="220" fill="${secondary ?? '#0d0d0d'}" opacity="0.95"/>
  <rect x="0" y="220" width="1080" height="3" fill="${emphasisColor}" opacity="0.9"/>
  <rect x="60" y="300" width="6" height="1300" fill="${emphasisColor}" opacity="0.85"/>
  <rect x="0" y="1700" width="1080" height="3" fill="${emphasisColor}" opacity="0.9"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

// ─── Map card — minimal radar frame, no text ─────────────────────────────────
// Removed coordinate labels and caption duplicate.

function mapCard(_scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const emphasisColor = accent ?? "#ffffff";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg ?? "#0a0a0a"}"/>
  <line x1="540" y1="200" x2="540" y2="1300" stroke="${emphasisColor}" stroke-width="1" opacity="0.08"/>
  <line x1="100" y1="750" x2="980" y2="750" stroke="${emphasisColor}" stroke-width="1" opacity="0.08"/>
  <circle cx="540" cy="750" r="420" fill="none" stroke="${emphasisColor}" stroke-width="1" opacity="0.10"/>
  <circle cx="540" cy="750" r="300" fill="none" stroke="${emphasisColor}" stroke-width="1" opacity="0.14"/>
  <circle cx="540" cy="750" r="180" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.20"/>
  <circle cx="540" cy="750" r="80" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.35"/>
  <circle cx="540" cy="750" r="22" fill="${emphasisColor}" opacity="0.8"/>
  <circle cx="540" cy="750" r="10" fill="${bg ?? "#0a0a0a"}"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

// ─── Timeline card — minimal nodes graphic, no text ──────────────────────────
// Removed "TIMELINE" header, scene-goal label, and caption duplicate.

function timelineCard(_scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const emphasisColor = accent ?? "#ffffff";
  const timelineY = 960;
  const nodeXs = [160, 310, 460, 620, 770, 920];
  const activeIdx = 2;

  const nodes = nodeXs
    .map(
      (x, i) => `
    <line x1="${i > 0 ? nodeXs[i - 1] : x}" y1="${timelineY}" x2="${x}" y2="${timelineY}"
          stroke="${i <= activeIdx ? emphasisColor : (secondary ?? '#333')}"
          stroke-width="${i <= activeIdx ? 3 : 2}" opacity="${i <= activeIdx ? 0.9 : 0.3}"/>
    <circle cx="${x}" cy="${timelineY}" r="${i === activeIdx ? 22 : 12}"
            fill="${i === activeIdx ? emphasisColor : 'none'}"
            stroke="${i <= activeIdx ? emphasisColor : (secondary ?? '#555')}"
            stroke-width="3" opacity="${i === activeIdx ? 1 : i < activeIdx ? 0.8 : 0.3}"/>
    ${i === activeIdx ? `<circle cx="${x}" cy="${timelineY}" r="34" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.4"/>` : ""}`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg ?? "#0a0a0a"}"/>
  ${nodes}
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function generateMotionGraphic(
  scene: ScenePlan,
  style: StyleProfile
): VisualAsset {
  const palette = style.colorStrategy.palette;
  let svg: string;

  switch (scene.visualMode) {
    // stockImage / stockVideo fell through every photo provider — render
    // a textless atmospheric gradient and let captions tell the story.
    case "stockImage":
    case "stockVideo":
      svg = atmosphericGradient(scene, palette);
      break;
    case "quoteCard":
      svg = quoteCard(scene, palette);
      break;
    case "evidenceCard":
      svg = evidenceCard(scene, palette);
      break;
    case "mapCard":
      svg = mapCard(scene, palette);
      break;
    case "timelineCard":
      svg = timelineCard(scene, palette);
      break;
    case "textCard":
      svg = textCard(scene, palette);
      break;
    case "gradientMotionCard":
    default:
      svg = gradientMotionCard(scene, palette);
      break;
  }

  const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return {
    type: scene.visualMode,
    provider: "generated",
    url: null,
    svgData,
    thumbnailUrl: null,
    metadata: {
      width: 1080,
      height: 1920,
      durationSeconds: null,
      attribution: null,
      sceneHash: sceneHash(scene),
    },
  };
}
