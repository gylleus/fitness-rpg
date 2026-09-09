import { describe, expect, it } from 'vitest';
import {
  createHeadDetectorState,
  stepHeadDetector,
  HEAD_DEFAULT_CONFIG,
  type HeadDetectorEvent,
  type HeadDetectorState,
  type HeadRepEvent,
} from './headDetector';
import { KEYPOINT, KEYPOINT_COUNT, type Keypoint, type PoseFrame } from '../pose/keypoints';

/**
 * Synthetic frames: a head-on body whose torso is displaced `drop` normalised
 * units from its resting position.
 *
 * Shoulder width is 0.2. Shoulders ride at 0.8x the drop and the face at 1.0x,
 * so a full rep of drop 0.16 measures ≈0.65 body-scale units of displacement
 * after smoothing.
 */
function headFrame(
  t: number,
  drop: number,
  opts: { score?: number; jitter?: () => number } = {},
): PoseFrame {
  const score = opts.score ?? 0.8;
  const j = opts.jitter ?? (() => 0);
  const keypoints: Keypoint[] = Array.from({ length: KEYPOINT_COUNT }, () => ({
    x: 0.5,
    y: 0.5,
    score: 0,
  }));
  const put = (i: number, x: number, y: number, s = score) => {
    keypoints[i] = { x: x + j(), y: y + j(), score: s };
  };
  put(KEYPOINT.NOSE, 0.5, 0.3 + drop);
  put(KEYPOINT.LEFT_EYE, 0.48, 0.28 + drop);
  put(KEYPOINT.RIGHT_EYE, 0.52, 0.28 + drop);
  put(KEYPOINT.LEFT_SHOULDER, 0.4, 0.45 + drop * 0.8);
  put(KEYPOINT.RIGHT_SHOULDER, 0.6, 0.45 + drop * 0.8);
  put(KEYPOINT.LEFT_HIP, 0.45, 0.7 + drop * 0.3);
  put(KEYPOINT.RIGHT_HIP, 0.55, 0.7 + drop * 0.3);
  return { t, keypoints };
}

const DT = 33;
const FULL_DROP = 0.16;

/** One down-and-up movement of the given drop, returning the end time. */
function rep(s: HeadDetectorState, startT: number, drop: number, halfMs: number): number {
  let t = startT;
  for (const end = t + halfMs; t < end; t += DT) {
    const p = (t - startT) / halfMs;
    stepHeadDetector(s, headFrame(t, drop * p), HEAD_DEFAULT_CONFIG);
  }
  for (const end = t + halfMs; t < end; t += DT) {
    const p = (t - startT - halfMs) / halfMs;
    stepHeadDetector(s, headFrame(t, drop * (1 - p)), HEAD_DEFAULT_CONFIG);
  }
  return t;
}

/** Hold still (silent reference capture), returning the end time. */
function settle(s: HeadDetectorState, startT: number, ms = 1500): number {
  let t = startT;
  for (const end = t + ms; t < end; t += DT) {
    stepHeadDetector(s, headFrame(t, 0), HEAD_DEFAULT_CONFIG);
  }
  return t;
}

/**
 * Settle, then one priming rep so the adaptive depth estimate matches this
 * synthetic geometry (≈0.65 units, against the 1.0 default). Tests that care
 * about counts record `s.reps` after this and assert deltas.
 */
function calibrate(s: HeadDetectorState, startT: number): number {
  let t = settle(s, startT);
  t = rep(s, t, FULL_DROP, 600);
  return settle(s, t, 400);
}

describe('silent calibration', () => {
  it('captures a reference from stillness alone and counts the first rep', () => {
    const s = createHeadDetectorState();
    const t = settle(s, 0);
    expect(s.calibrated).toBe(true);
    rep(s, t, FULL_DROP, 600);
    expect(s.reps).toBe(1);
  });

  it('adapts the depth estimate to the reps actually performed', () => {
    const s = createHeadDetectorState();
    let t = settle(s, 0);
    expect(s.depthD).toBe(HEAD_DEFAULT_CONFIG.defaultDepthD);
    t = rep(s, t, FULL_DROP, 600);
    // The estimate now reflects this geometry's real excursion.
    expect(s.depthD).toBeGreaterThan(0.55);
    expect(s.depthD).toBeLessThan(0.8);
    // The first rep was scored against the default and reads shallow; the
    // second is scored against the adapted estimate and reads full.
    rep(s, t, FULL_DROP, 600);
    expect(s.reps).toBe(2);
    expect(s.lastRepValid).toBe(true);
  });

  it('counts nothing before a reference exists', () => {
    const s = createHeadDetectorState();
    let t = 0;
    for (let i = 0; i < 5; i++) t = rep(s, t, FULL_DROP, 400);
    expect(s.calibrated).toBe(false);
    expect(s.reps).toBe(0);
  });

  it('calibrates and counts with the hips out of frame', () => {
    const noHips = (t: number, drop: number): PoseFrame => {
      const f = headFrame(t, drop);
      f.keypoints[KEYPOINT.LEFT_HIP].score = 0;
      f.keypoints[KEYPOINT.RIGHT_HIP].score = 0;
      return f;
    };
    const s = createHeadDetectorState();
    let t = 0;
    for (; t < 1500; t += DT) stepHeadDetector(s, noHips(t, 0), HEAD_DEFAULT_CONFIG);
    expect(s.calibrated).toBe(true);
    const startT = t;
    for (const end = t + 600; t < end; t += DT) {
      stepHeadDetector(s, noHips(t, FULL_DROP * ((t - startT) / 600)), HEAD_DEFAULT_CONFIG);
    }
    for (const end = t + 600; t < end; t += DT) {
      stepHeadDetector(s, noHips(t, FULL_DROP * (1 - (t - startT - 600) / 600)), HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(1);
  });

  it('one anomalous deep excursion does not poison the depth estimate', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    for (let i = 0; i < 2; i++) t = rep(s, t, FULL_DROP, 600);
    const before = s.depthD;
    // Twice as deep as any real rep, but under the wander bound.
    t = rep(s, t, FULL_DROP * 2, 800);
    expect(s.depthD).toBeLessThan(before * 1.3);
  });
});

describe('confidence flicker', () => {
  it('calibrates while one shoulder flickers across the confidence gate', () => {
    // The field failure: a shoulder score oscillating around the gate snapped
    // the old blended midpoint back and forth by half a shoulder width, which
    // restarted the stillness hold for 13 straight seconds. Per-source
    // references must be immune: the body is perfectly still here.
    const s = createHeadDetectorState();
    let t = 0;
    let frames = 0;
    for (; t < 1500; t += DT, frames++) {
      const f = headFrame(t, 0);
      if (frames % 3 === 0) f.keypoints[KEYPOINT.LEFT_SHOULDER].score = 0.1;
      stepHeadDetector(s, f, HEAD_DEFAULT_CONFIG);
    }
    expect(s.calibrated).toBe(true);
  });

  it('does not fake displacement when a shoulder drops out mid-set', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    let frames = 0;
    for (const end = t + 10000; t < end; t += DT, frames++) {
      const f = headFrame(t, 0);
      if (frames % 4 < 2) f.keypoints[KEYPOINT.LEFT_SHOULDER].score = 0.1;
      stepHeadDetector(s, f, HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(base);
    // And real reps still count through the flicker.
    for (let i = 0; i < 3; i++) {
      const startT = t;
      for (const end = t + 500; t < end; t += DT, frames++) {
        const p = (t - startT) / 500;
        const f = headFrame(t, FULL_DROP * p);
        if (frames % 4 < 2) f.keypoints[KEYPOINT.LEFT_SHOULDER].score = 0.1;
        stepHeadDetector(s, f, HEAD_DEFAULT_CONFIG);
      }
      for (const end = t + 500; t < end; t += DT, frames++) {
        const p = (t - startT - 500) / 500;
        const f = headFrame(t, FULL_DROP * (1 - p));
        if (frames % 4 < 2) f.keypoints[KEYPOINT.LEFT_SHOULDER].score = 0.1;
        stepHeadDetector(s, f, HEAD_DEFAULT_CONFIG);
      }
    }
    expect(s.reps).toBe(base + 3);
  });
});

describe('counting', () => {
  it('counts a single full-depth rep', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    rep(s, t, FULL_DROP, 600);
    expect(s.reps).toBe(base + 1);
    expect(s.lastRepValid).toBe(true);
  });

  it('counts ten consecutive reps exactly once each', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const partialsBase = s.partials;
    for (let i = 0; i < 10; i++) t = rep(s, t, FULL_DROP, 500);
    expect(s.reps).toBe(base + 10);
    expect(s.partials).toBe(partialsBase);
  });

  it('counts fast reps', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    for (let i = 0; i < 8; i++) t = rep(s, t, FULL_DROP, 200);
    expect(s.reps).toBe(base + 8);
  });

  it('counts every rep of a fast set that never fully locks out', () => {
    // The merged-set case: at speed the body rebounds at ~40% depth instead of
    // returning to the top. Rebound completion must close each rep anyway.
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const lockout = FULL_DROP * 0.38;
    for (let i = 0; i < 6; i++) {
      const down = i === 0 ? 0 : lockout;
      const startT = t;
      for (const end = t + 300; t < end; t += DT) {
        const p = (t - startT) / 300;
        stepHeadDetector(s, headFrame(t, down + (FULL_DROP - down) * p), HEAD_DEFAULT_CONFIG);
      }
      for (const end = t + 300; t < end; t += DT) {
        const p = (t - startT - 300) / 300;
        stepHeadDetector(s, headFrame(t, FULL_DROP - (FULL_DROP - lockout) * p), HEAD_DEFAULT_CONFIG);
      }
    }
    expect(s.reps).toBe(base + 6);
  });

  it('marks a shallow rep as not valid but still counts it', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const partialsBase = s.partials;
    rep(s, t, FULL_DROP * 0.65, 600);
    expect(s.reps).toBe(base + 1);
    expect(s.partials).toBe(partialsBase + 1);
    expect(s.lastRepValid).toBe(false);
  });

  it('ignores a dip too small to be a rep attempt', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    rep(s, t, FULL_DROP * 0.3, 600);
    expect(s.reps).toBe(base);
  });
});

describe('noise immunity', () => {
  it('counts nothing from a motionless jittering body', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * 0.01;
    };
    for (const end = t + 30000; t < end; t += DT) {
      stepHeadDetector(s, headFrame(t, 0, { jitter: rnd }), HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(base);
  });

  it('still counts real reps through the same jitter', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * 0.01;
    };
    for (let i = 0; i < 5; i++) {
      const startT = t;
      for (const end = t + 600; t < end; t += DT) {
        const p = (t - startT) / 600;
        stepHeadDetector(s, headFrame(t, FULL_DROP * p, { jitter: rnd }), HEAD_DEFAULT_CONFIG);
      }
      for (const end = t + 600; t < end; t += DT) {
        const p = (t - startT - 600) / 600;
        stepHeadDetector(s, headFrame(t, FULL_DROP * (1 - p), { jitter: rnd }), HEAD_DEFAULT_CONFIG);
      }
    }
    expect(s.reps).toBe(base + 5);
  });
});

describe('leaving the position', () => {
  it('does not count standing up and coming back as a rep', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const events: HeadDetectorEvent[] = [];
    const far = FULL_DROP * 3.5;
    for (const end = t + 800; t < end; t += DT) {
      const p = (t - (end - 800)) / 800;
      events.push(...stepHeadDetector(s, headFrame(t, far * p), HEAD_DEFAULT_CONFIG));
    }
    for (const end = t + 2000; t < end; t += DT) {
      events.push(...stepHeadDetector(s, headFrame(t, far), HEAD_DEFAULT_CONFIG));
    }
    for (const end = t + 800; t < end; t += DT) {
      const p = (t - (end - 800)) / 800;
      events.push(...stepHeadDetector(s, headFrame(t, far * (1 - p)), HEAD_DEFAULT_CONFIG));
    }
    expect(s.reps).toBe(base);
    expect(events.some((e) => e.type === 'positionLost')).toBe(true);
    // Standing still for 2 seconds adopted the standing pose as the new
    // reference (rest-anywhere semantics), so returning to the plank needs a
    // fresh settle before counting resumes.
    t = settle(s, t);
    expect(s.reps).toBe(base);
    rep(s, t, FULL_DROP, 600);
    expect(s.reps).toBe(base + 1);
  });

  it('recaptures the reference when the setup moves', () => {
    // The phone gets nudged: the old reference is permanently wrong, and the
    // session must self-heal from a fresh stillness instead of demanding a
    // manual reset.
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const offset = FULL_DROP * 3;
    // Jump to a far-away position and stay there.
    const events: HeadDetectorEvent[] = [];
    for (const end = t + 2500; t < end; t += DT) {
      events.push(...stepHeadDetector(s, headFrame(t, offset), HEAD_DEFAULT_CONFIG));
    }
    expect(events.some((e) => e.type === 'positionLost')).toBe(true);
    expect(events.some((e) => e.type === 'positionAcquired')).toBe(true);
    // Reps measured from the NEW resting position count.
    const startT = t;
    for (const end = t + 600; t < end; t += DT) {
      const p = (t - startT) / 600;
      stepHeadDetector(s, headFrame(t, offset + FULL_DROP * p), HEAD_DEFAULT_CONFIG);
    }
    for (const end = t + 600; t < end; t += DT) {
      const p = (t - startT - 600) / 600;
      stepHeadDetector(s, headFrame(t, offset + FULL_DROP * (1 - p)), HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(base + 1);
  });
});

describe('tracking loss', () => {
  it('abandons a rep whose middle was not observed', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    for (const end = t + 300; t < end; t += DT) {
      const p = (t - (end - 300)) / 300;
      stepHeadDetector(s, headFrame(t, FULL_DROP * p), HEAD_DEFAULT_CONFIG);
    }
    const events: HeadDetectorEvent[] = [];
    for (let i = 0; i < 20; i++, t += DT) {
      events.push(...stepHeadDetector(s, headFrame(t, FULL_DROP, { score: 0.05 }), HEAD_DEFAULT_CONFIG));
    }
    expect(events.some((e) => e.type === 'trackingLost')).toBe(true);
    for (const end = t + 500; t < end; t += DT) {
      events.push(...stepHeadDetector(s, headFrame(t, 0), HEAD_DEFAULT_CONFIG));
    }
    expect(s.reps).toBe(base);
    // But the next full rep counts.
    rep(s, t, FULL_DROP, 600);
    expect(s.reps).toBe(base + 1);
  });
});

describe('reference drift', () => {
  it('absorbs slow drift of the resting position without counting it', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const start = t;
    for (const end = t + 20000; t < end; t += DT) {
      const p = (t - start) / 20000;
      stepHeadDetector(s, headFrame(t, 0.1 * p), HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(base);
    // Reps measured from the drifted position still count.
    const drifted = 0.1;
    const startT = t;
    for (const end = t + 600; t < end; t += DT) {
      const p = (t - startT) / 600;
      stepHeadDetector(s, headFrame(t, drifted + FULL_DROP * p), HEAD_DEFAULT_CONFIG);
    }
    for (const end = t + 600; t < end; t += DT) {
      const p = (t - startT - 600) / 600;
      stepHeadDetector(s, headFrame(t, drifted + FULL_DROP * (1 - p)), HEAD_DEFAULT_CONFIG);
    }
    expect(s.reps).toBe(base + 1);
  });
});

describe('rep events', () => {
  it('emits one event per rep with monotonic indices', () => {
    const s = createHeadDetectorState();
    let t = calibrate(s, 0);
    const base = s.reps;
    const events: HeadDetectorEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const startT = t;
      for (const end = t + 500; t < end; t += DT) {
        const p = (t - startT) / 500;
        events.push(...stepHeadDetector(s, headFrame(t, FULL_DROP * p), HEAD_DEFAULT_CONFIG));
      }
      for (const end = t + 500; t < end; t += DT) {
        const p = (t - startT - 500) / 500;
        events.push(...stepHeadDetector(s, headFrame(t, FULL_DROP * (1 - p)), HEAD_DEFAULT_CONFIG));
      }
    }
    const reps = events.filter((e): e is HeadRepEvent => e.type === 'rep');
    expect(reps).toHaveLength(4);
    expect(reps.map((r) => r.index)).toEqual([base + 1, base + 2, base + 3, base + 4]);
    for (const r of reps) {
      expect(r.durationMs).toBeGreaterThan(0);
      expect(r.depth).toBeGreaterThan(0.5);
    }
  });
});
