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

// ─── SVG Templates ────────────────────────────────────────────────────────────

function gradientMotionCard(scene: ScenePlan, palette: string[]): string {
  const [bg1, bg2, accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineHeight = 80;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (1920 - totalTextHeight) / 2;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="540" y="${startY + i * lineHeight}" text-anchor="middle" font-size="72" font-weight="bold" fill="white" font-family="Georgia, serif" opacity="0.95">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bg1}"/>
      <stop offset="60%" style="stop-color:${bg2}"/>
      <stop offset="100%" style="stop-color:${accent ?? bg1}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%" style="stop-color:transparent"/>
      <stop offset="100%" style="stop-color:rgba(0,0,0,0.6)"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect width="1080" height="1920" fill="url(#vignette)"/>
  ${textElements}
  <line x1="100" y1="${startY - 40}" x2="980" y2="${startY - 40}" stroke="${accent ?? '#ffffff'}" stroke-width="3" opacity="0.5"/>
</svg>`;
}

function textCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 20);
  const lineHeight = 90;
  const startY = (1920 - lines.length * lineHeight) / 2;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="540" y="${startY + i * lineHeight}" text-anchor="middle" font-size="80" font-weight="900" fill="${accent ?? '#ffffff'}" font-family="Impact, Arial Black, sans-serif" letter-spacing="2">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <rect x="0" y="${startY - 80}" width="8" height="${lines.length * lineHeight + 60}" fill="${accent ?? '#ffffff'}"/>
  ${textElements}
  <text x="540" y="${startY + lines.length * lineHeight + 60}" text-anchor="middle" font-size="36" fill="${accent ?? '#ffffff'}" opacity="0.5" font-family="Helvetica, sans-serif" letter-spacing="8">${escapeSvg(scene.mood.toUpperCase())}</text>
</svg>`;
}

function quoteCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 24);
  const lineHeight = 76;
  const startY = (1920 - lines.length * lineHeight) / 2;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="540" y="${startY + i * lineHeight}" text-anchor="middle" font-size="68" fill="white" font-family="Georgia, 'Times New Roman', serif" font-style="italic">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <text x="120" y="${startY - 30}" font-size="200" fill="${accent ?? '#ffffff'}" opacity="0.15" font-family="Georgia, serif">"</text>
  ${textElements}
  <text x="960" y="${startY + lines.length * lineHeight + 120}" font-size="200" fill="${accent ?? '#ffffff'}" opacity="0.15" font-family="Georgia, serif" text-anchor="end">"</text>
  <line x1="200" y1="${startY + lines.length * lineHeight + 40}" x2="880" y2="${startY + lines.length * lineHeight + 40}" stroke="${accent ?? '#ffffff'}" stroke-width="2" opacity="0.4"/>
</svg>`;
}

function evidenceCard(scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 26);
  const lineHeight = 64;
  const startY = 700;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="140" y="${startY + i * lineHeight}" font-size="58" fill="white" font-family="Helvetica Neue, sans-serif" font-weight="300">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <rect x="0" y="0" width="1080" height="200" fill="${secondary ?? '#111111'}" opacity="0.8"/>
  <text x="80" y="130" font-size="48" fill="${accent ?? '#ffffff'}" font-family="Helvetica, sans-serif" font-weight="bold" letter-spacing="6">EVIDENCE</text>
  <rect x="80" y="580" width="920" height="3" fill="${accent ?? '#ffffff'}" opacity="0.4"/>
  ${textElements}
  <circle cx="80" cy="${startY + (lines.length * lineHeight) / 2}" r="20" fill="${accent ?? '#ffffff'}" opacity="0.3"/>
</svg>`;
}

function mapCard(scene: ScenePlan, palette: string[]): string {
  const [bg, , accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineHeight = 70;
  const textY = 1400;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="540" y="${textY + i * lineHeight}" text-anchor="middle" font-size="62" fill="white" font-family="Helvetica, sans-serif" font-weight="500">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <circle cx="540" cy="800" r="350" fill="none" stroke="${accent ?? '#ffffff'}" stroke-width="2" opacity="0.15"/>
  <circle cx="540" cy="800" r="250" fill="none" stroke="${accent ?? '#ffffff'}" stroke-width="2" opacity="0.2"/>
  <circle cx="540" cy="800" r="150" fill="none" stroke="${accent ?? '#ffffff'}" stroke-width="2" opacity="0.3"/>
  <circle cx="540" cy="800" r="60" fill="${accent ?? '#ffffff'}" opacity="0.6"/>
  <circle cx="540" cy="800" r="20" fill="${accent ?? '#ffffff'}"/>
  <line x1="540" y1="450" x2="540" y2="1150" stroke="${accent ?? '#ffffff'}" stroke-width="1" opacity="0.1"/>
  <line x1="190" y1="800" x2="890" y2="800" stroke="${accent ?? '#ffffff'}" stroke-width="1" opacity="0.1"/>
  ${textElements}
</svg>`;
}

function timelineCard(scene: ScenePlan, palette: string[]): string {
  const [bg, secondary, accent] = palette;
  const lines = wrapText(escapeSvg(scene.caption), 22);
  const lineHeight = 68;
  const textY = 1300;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="540" y="${textY + i * lineHeight}" text-anchor="middle" font-size="60" fill="white" font-family="Helvetica, sans-serif">${line}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <line x1="540" y1="200" x2="540" y2="1200" stroke="${secondary ?? '#333333'}" stroke-width="4"/>
  ${[300, 500, 700, 900, 1100].map((y, i) =>
    `<circle cx="540" cy="${y}" r="18" fill="${i === 2 ? accent ?? '#ffffff' : secondary ?? '#333333'}" stroke="${accent ?? '#ffffff'}" stroke-width="3"/>
     <rect x="580" y="${y - 22}" width="340" height="44" fill="${secondary ?? '#222222'}" rx="4" opacity="0.6"/>
     <text x="600" y="${y + 8}" font-size="32" fill="white" font-family="Helvetica, sans-serif" opacity="0.7">───────</text>`
  ).join("\n")}
  ${textElements}
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
