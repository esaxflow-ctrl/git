/**
 * Kill switch: presence of the configured file (default `STOP_BOT.txt`) halts
 * all new entries instantly. Existing positions are *not* force-closed by the
 * kill switch alone — exit manager makes that decision — but no new buys are
 * allowed.
 *
 * Drop the file in the project root to halt. Delete it to re-arm.
 */

import { existsSync, statSync } from 'node:fs';

export class KillSwitch {
  constructor(private readonly path: string) {}

  isEngaged(): boolean {
    try {
      return existsSync(this.path);
    } catch {
      return false;
    }
  }

  /** When the kill switch was activated (mtime), or null. */
  engagedSince(): number | null {
    try {
      if (!this.isEngaged()) return null;
      return statSync(this.path).mtimeMs;
    } catch {
      return null;
    }
  }

  filePath(): string {
    return this.path;
  }
}
