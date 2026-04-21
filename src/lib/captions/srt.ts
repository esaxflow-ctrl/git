import { CaptionEntry } from "../validation/schemas";

function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

export function exportSRT(entries: CaptionEntry[]): string {
  return entries
    .map((entry, index) => {
      const start = formatSrtTime(entry.startMs);
      const end = formatSrtTime(entry.endMs);
      return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
    })
    .join("\n");
}
