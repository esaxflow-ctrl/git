import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KillSwitch } from '../risk/killSwitch.js';

const path = join(tmpdir(), `STOP_BOT_${Date.now()}_${Math.random()}.txt`);

afterEach(() => {
  if (existsSync(path)) unlinkSync(path);
});

describe('KillSwitch', () => {
  it('reports off when file missing', () => {
    const ks = new KillSwitch(path);
    expect(ks.isEngaged()).toBe(false);
    expect(ks.engagedSince()).toBeNull();
  });

  it('reports engaged when file exists', () => {
    writeFileSync(path, 'STOP');
    const ks = new KillSwitch(path);
    expect(ks.isEngaged()).toBe(true);
    expect(typeof ks.engagedSince()).toBe('number');
  });
});
