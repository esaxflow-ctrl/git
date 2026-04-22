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

// ─── Cinematic gradient motion card — emotional opener / atmosphere ────────────

function gradientMotionCard(scene: ScenePlan, palette: string[]): string {
  const [bg1, bg2, accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 18);
  const lineH = 96;
  const blockH = lines.length * lineH;
  const blockY = 1920 * 0.58; // lower-third position

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${blockY + i * lineH}" font-size="82" font-weight="800"
         fill="white" font-family="Georgia, serif" letter-spacing="-1"
         filter="url(#grain)" opacity="0.97">${line}</text>`
    )
    .join("\n  ");

  const moodLabel = escapeSvg((scene.mood ?? "").toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(accent ?? "#ffffff")}
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="55%" stop-color="${bg2 ?? bg1}"/>
      <stop offset="100%" stop-color="${accent ?? bg1}" stop-opacity="0.4"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bgGrad)"/>
  <rect width="1080" height="1920" fill="url(#vig)"/>
  <!-- Thin horizontal accent bars -->
  <rect x="0" y="60" width="1080" height="2" fill="${accent ?? '#ffffff'}" opacity="0.18"/>
  <rect x="0" y="1860" width="1080" height="2" fill="${accent ?? '#ffffff'}" opacity="0.18"/>
  <!-- Left vertical accent stripe -->
  <rect x="52" y="${blockY - 24}" width="4" height="${blockH + 16}" fill="${accent ?? '#ffffff'}" opacity="0.9"/>
  <!-- Mood label — small caps, faint -->
  <text x="80" y="${blockY - 50}" font-size="28" fill="${accent ?? '#ffffff'}" opacity="0.55"
        font-family="Helvetica Neue, sans-serif" letter-spacing="10" font-weight="300">${moodLabel}</text>
  <!-- Main text -->
  ${textSvg}
  <!-- Grain overlay for film texture -->
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

// ─── Quote card — editorial pull-quote / inner monologue ─────────────────────

function quoteCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineH = 84;
  const blockH = lines.length * lineH;
  const startY = (1920 - blockH) / 2 - 60;
  const emphasisColor = accent ?? "#ffffff";

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="100" y="${startY + i * lineH + 70}" font-size="72" fill="white"
         font-family="Georgia, 'Times New Roman', serif" font-style="italic"
         font-weight="400" letter-spacing="0.5">${line}</text>`
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg}"/>
  <!-- Vignette for depth -->
  <rect width="1080" height="1920" fill="url(#vig)"/>
  <!-- Large decorative opening quote -->
  <text x="72" y="${startY - 20}" font-size="280" fill="${emphasisColor}" opacity="0.12"
        font-family="Georgia, serif" font-weight="900">"</text>
  <!-- Top rule -->
  <rect x="80" y="${startY - 30}" width="920" height="2" fill="${emphasisColor}" opacity="0.5"/>
  <!-- Quote text -->
  ${textSvg}
  <!-- Bottom rule -->
  <rect x="80" y="${startY + blockH + 50}" width="920" height="2" fill="${emphasisColor}" opacity="0.5"/>
  <!-- Closing quote -->
  <text x="960" y="${startY + blockH + 220}" font-size="280" fill="${emphasisColor}" opacity="0.12"
        font-family="Georgia, serif" font-weight="900" text-anchor="end">"</text>
  <!-- Attribution dash -->
  <text x="80" y="${startY + blockH + 110}" font-size="32" fill="${emphasisColor}" opacity="0.5"
        font-family="Helvetica Neue, sans-serif" letter-spacing="5" font-weight="300">— YOU, PROBABLY</text>
</svg>`;
}

// ─── Evidence card — documentary / newspaper style ────────────────────────────

function evidenceCard(scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const emphasisColor = accent ?? "#e8e8e8";
  const lines = wrapText(escapeSvg(scene.caption), 24);
  const lineH = 68;
  const bodyY = 820;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="100" y="${bodyY + i * lineH}" font-size="60" fill="white"
         font-family="Helvetica Neue, sans-serif" font-weight="300">${line}</text>`
    )
    .join("\n  ");

  // Key word or phrase for large callout
  const keyWord = (scene.emphasisWords?.[0] ?? scene.mood ?? "FACT").toUpperCase();
  const sceneLabel = escapeSvg((scene.sceneGoal ?? "EVIDENCE").split(" ").slice(0, 3).join(" ").toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg}"/>
  <!-- Header band -->
  <rect x="0" y="0" width="1080" height="220" fill="${secondary ?? '#0d0d0d'}" opacity="0.95"/>
  <rect x="0" y="220" width="1080" height="3" fill="${emphasisColor}" opacity="0.9"/>
  <!-- Document category label -->
  <text x="100" y="100" font-size="32" fill="${emphasisColor}" opacity="0.75"
        font-family="Helvetica Neue, sans-serif" font-weight="700" letter-spacing="8">FINDING</text>
  <!-- Scene goal as subheading -->
  <text x="100" y="170" font-size="46" fill="white"
        font-family="Helvetica Neue, sans-serif" font-weight="600" letter-spacing="1">${sceneLabel}</text>
  <!-- Accent bracket — left edge highlight -->
  <rect x="60" y="300" width="6" height="${lines.length * lineH + 300}" fill="${emphasisColor}" opacity="0.85"/>
  <!-- Large keyword callout -->
  <text x="100" y="650" font-size="160" fill="${emphasisColor}" opacity="0.12"
        font-family="Impact, Arial Black, sans-serif" letter-spacing="-4">${escapeSvg(keyWord)}</text>
  <!-- Divider -->
  <rect x="100" y="770" width="880" height="2" fill="${emphasisColor}" opacity="0.35"/>
  <!-- Body text -->
  ${textSvg}
  <!-- Vignette -->
  <rect width="1080" height="1920" fill="url(#vig)"/>
  <!-- Source indicator bottom -->
  <text x="100" y="1840" font-size="26" fill="white" opacity="0.3"
        font-family="Helvetica Neue, sans-serif" letter-spacing="3" font-weight="300">SOURCE: OBSERVED BEHAVIOR PATTERN</text>
</svg>`;
}

// ─── Map card — scale / systemic view ────────────────────────────────────────

function mapCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const emphasisColor = accent ?? "#ffffff";
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineH = 72;
  const textY = 1380;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="540" y="${textY + i * lineH}" text-anchor="middle" font-size="64"
         fill="white" font-family="Helvetica Neue, sans-serif" font-weight="500">${line}</text>`
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg}"/>
  <!-- Crosshair grid -->
  <line x1="540" y1="200" x2="540" y2="1300" stroke="${emphasisColor}" stroke-width="1" opacity="0.08"/>
  <line x1="100" y1="750" x2="980" y2="750" stroke="${emphasisColor}" stroke-width="1" opacity="0.08"/>
  <!-- Outer rings -->
  <circle cx="540" cy="750" r="420" fill="none" stroke="${emphasisColor}" stroke-width="1" opacity="0.10"/>
  <circle cx="540" cy="750" r="300" fill="none" stroke="${emphasisColor}" stroke-width="1" opacity="0.14"/>
  <circle cx="540" cy="750" r="180" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.20"/>
  <circle cx="540" cy="750" r="80" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.35"/>
  <!-- Center target -->
  <circle cx="540" cy="750" r="22" fill="${emphasisColor}" opacity="0.8"/>
  <circle cx="540" cy="750" r="10" fill="${bg}"/>
  <!-- Coordinate labels -->
  <text x="555" y="345" font-size="24" fill="${emphasisColor}" opacity="0.35"
        font-family="Helvetica, monospace" letter-spacing="2">0.00° N</text>
  <text x="940" y="758" font-size="24" fill="${emphasisColor}" opacity="0.35"
        font-family="Helvetica, monospace" letter-spacing="2">0.00° E</text>
  <!-- Divider line above text -->
  <rect x="120" y="${textY - 40}" width="840" height="2" fill="${emphasisColor}" opacity="0.3"/>
  ${textSvg}
  <rect width="1080" height="1920" fill="url(#vig)"/>
</svg>`;
}

// ─── Timeline card — documentary progression ──────────────────────────────────

function timelineCard(scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const emphasisColor = accent ?? "#ffffff";
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineH = 70;
  const textY = 1300;

  const textSvg = lines
    .map(
      (line, i) =>
        `<text x="540" y="${textY + i * lineH}" text-anchor="middle" font-size="62"
         fill="white" font-family="Helvetica Neue, sans-serif" font-weight="400">${line}</text>`
    )
    .join("\n  ");

  // Horizontal timeline with 5 steps, node 3 is active
  const timelineY = 860;
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
    ${i === activeIdx ? `<circle cx="${x}" cy="${timelineY}" r="34" fill="none" stroke="${emphasisColor}" stroke-width="2" opacity="0.4"/>` : ""}
    <text x="${x}" y="${timelineY + 50}" text-anchor="middle" font-size="22"
          fill="${emphasisColor}" opacity="${i <= activeIdx ? 0.6 : 0.2}"
          font-family="Helvetica, monospace" letter-spacing="2">${String(i + 1).padStart(2, "0")}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  ${sharedDefs(emphasisColor)}
  <rect width="1080" height="1920" fill="${bg}"/>
  <!-- Timeline header -->
  <text x="100" y="480" font-size="28" fill="${emphasisColor}" opacity="0.5"
        font-family="Helvetica Neue, sans-serif" letter-spacing="8" font-weight="300">TIMELINE</text>
  <rect x="100" y="510" width="880" height="2" fill="${emphasisColor}" opacity="0.25"/>
  <!-- Scene goal as context label -->
  <text x="100" y="720" font-size="54" fill="white" opacity="0.85"
        font-family="Helvetica Neue, sans-serif" font-weight="600">${escapeSvg((scene.sceneGoal ?? "").split(" ").slice(0, 4).join(" "))}</text>
  <!-- Timeline nodes -->
  ${nodes}
  <!-- Divider -->
  <rect x="100" y="${textY - 50}" width="880" height="2" fill="${emphasisColor}" opacity="0.25"/>
  <!-- Caption text -->
  ${textSvg}
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
