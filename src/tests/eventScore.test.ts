import { describe, it, expect } from 'vitest';
import { scoreEvent } from '../scoring/eventScore.js';
import { fakeSnapshot } from './helpers.js';

describe('eventScore', () => {
  it('verifies a major launch only with full confirmations', () => {
    const r = scoreEvent({
      sourceCredibility: 95,
      caInOfficialSource: true,
      caOnDexScreener: true,
      caOnBirdeye: true,
      competingCAs: 1,
      buzzScore: 80,
      smartWalletScore: 70,
      volumeAccelerationScore: 80,
      snap: fakeSnapshot(),
      safetyScore: 90,
      postAgeMinutes: 5,
      narrativeScore: 60,
    });
    expect(r.signalType).toBe('VERIFIED_MAJOR_LAUNCH');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('flags FAKE_LAUNCH_RISK with competing CAs', () => {
    const r = scoreEvent({
      sourceCredibility: 95,
      caInOfficialSource: true,
      caOnDexScreener: true,
      caOnBirdeye: true,
      competingCAs: 3,
      buzzScore: 80,
      smartWalletScore: 60,
      volumeAccelerationScore: 70,
      snap: fakeSnapshot(),
      safetyScore: 80,
      postAgeMinutes: 5,
      narrativeScore: 50,
    });
    expect(r.signalType).toBe('FAKE_LAUNCH_RISK');
  });

  it('flags TOO_LATE_PASS for old posts', () => {
    const r = scoreEvent({
      sourceCredibility: 95,
      caInOfficialSource: true,
      caOnDexScreener: true,
      caOnBirdeye: true,
      competingCAs: 1,
      buzzScore: 60,
      smartWalletScore: 50,
      volumeAccelerationScore: 50,
      snap: fakeSnapshot(),
      safetyScore: 80,
      postAgeMinutes: 90,
      narrativeScore: 50,
    });
    expect(['TOO_LATE_PASS', 'POSSIBLE_MAJOR_LAUNCH']).toContain(r.signalType);
  });

  it('penalises if official post deleted', () => {
    const r = scoreEvent({
      sourceCredibility: 90,
      caInOfficialSource: true,
      caOnDexScreener: true,
      caOnBirdeye: true,
      competingCAs: 1,
      buzzScore: 80,
      smartWalletScore: 70,
      volumeAccelerationScore: 70,
      snap: fakeSnapshot(),
      safetyScore: 80,
      postAgeMinutes: 5,
      postDeleted: true,
      narrativeScore: 50,
    });
    expect(r.signalType).toBe('FAKE_LAUNCH_RISK');
  });
});
