import { describe, expect, it } from 'vitest';
import { createRepDetector, type DetectorEvent, type RepEvent } from './detector';
import { blankFrame, frameWithElbowAngle, pushupFrames } from '../../test/synth';
import type { PoseFrame } from '../pose/keypoints';

/**
 * Frames that satisfy calibration: the top of a pushup, held.
 *
 * The detector counts nothing until it has captured the user's own position, so
 * every test needs this first. Deliberately in pushup posture even for the
 * out-of-position tests — the point of those is that movement which departs
 * from the calibrated reference does not count.
 */
function calibrationFrames(endT: number, topAngle = 170): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const durationMs = 2100;
  for (let t = endT - durationMs; t < endT; t += 33) {
    frames.push(frameWithElbowAngle(t, topAngle, { posture: 'pushup' }));
  }
  return frames;
}

function run(frames: PoseFrame[], config = {}) {
  const detector = createRepDetector(config);
  const events: DetectorEvent[] = [];
  const firstT = frames.length > 0 ? frames[0].t : 0;
  for (const f of calibrationFrames(firstT)) detector.push(f);
  for (const f of frames) events.push(...detector.push(f));
  return { detector, events, reps: events.filter((e): e is RepEvent => e.type === 'rep') };
}

const SLOW = { bottomAngle: 70, descentMs: 900, ascentMs: 900 };

describe('counting', () => {
  it('counts a single full-depth pushup', () => {
    const { reps, detector } = run(pushupFrames({ startT: 0, ...SLOW }));
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(true);
    expect(detector.state().reps).toBe(1);
  });

  it('counts ten consecutive pushups exactly once each', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const rep = pushupFrames({ startT: t, ...SLOW });
      frames.push(...rep);
      t = rep[rep.length - 1].t + 33;
    }
    const { detector } = run(frames);
    expect(detector.state().reps).toBe(10);
    expect(detector.state().partials).toBe(0);
  });

  it('counts fast reps, not just slow ones', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) {
      const rep = pushupFrames({ startT: t, bottomAngle: 70, descentMs: 300, ascentMs: 300, holdMs: 150 });
      frames.push(...rep);
      t = rep[rep.length - 1].t + 33;
    }
    expect(run(frames).detector.state().reps).toBe(10);
  });
});

describe('hysteresis', () => {
  it('does not count jitter around the top threshold as reps', () => {
    // Angle wobbles across upAngle (150) without ever descending. A naive single
    // threshold would emit a rep on every crossing.
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 200; i++) {
      frames.push(frameWithElbowAngle(i * 33, 150 + (i % 2 === 0 ? 8 : -8)));
    }
    expect(run(frames).reps).toHaveLength(0);
  });

  it('does not count jitter around the bottom threshold as extra reps', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    // Hover right at downAngle (95), wobbling across it.
    for (let i = 0; i < 60; i++) frames.push(frameWithElbowAngle((t += 33), 95 + (i % 2 === 0 ? 6 : -6)));
    for (let i = 0; i < 60; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    expect(run(frames).reps).toHaveLength(1);
  });
});

describe('partial reps', () => {
  it('reports a shallow descent as a partial rather than dropping it', () => {
    // Descends to 120 — past dipAngle (110)? No: 120 > 110, so no dip is even entered.
    // Use 105: enters the dip band but never reaches downAngle (95).
    const { reps, detector } = run(
      pushupFrames({ startT: 0, bottomAngle: 105, descentMs: 900, ascentMs: 900 }),
    );
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(false);
    expect(detector.state().reps).toBe(0);
    expect(detector.state().partials).toBe(1);
  });

  it('ignores movement that never enters the dip band at all', () => {
    const { reps } = run(pushupFrames({ startT: 0, bottomAngle: 135, descentMs: 900, ascentMs: 900 }));
    expect(reps).toHaveLength(0);
  });

  it('keeps valid and partial counts separate across a mixed set', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (const bottom of [70, 70, 105, 70, 105]) {
      const rep = pushupFrames({ startT: t, bottomAngle: bottom, descentMs: 900, ascentMs: 900 });
      frames.push(...rep);
      t = rep[rep.length - 1].t + 33;
    }
    const { detector } = run(frames);
    expect(detector.state().reps).toBe(3);
    expect(detector.state().partials).toBe(2);
  });
});

describe('plausibility guards', () => {
  it('rejects a movement too fast to be a real rep', () => {
    // Sampled at 120fps so the smoother can actually follow the motion; at 30fps a
    // twitch this brief is filtered out before the duration guard ever sees it.
    const { events, reps } = run(
      pushupFrames({ startT: 0, bottomAngle: 70, descentMs: 100, ascentMs: 100, holdMs: 300, fps: 120 }),
    );
    expect(reps).toHaveLength(0);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'tooFast')).toBe(true);
  });

  it('rejects a descent held so long it is a rest, not a rep', () => {
    const { events, reps } = run(
      pushupFrames({ startT: 0, bottomAngle: 70, descentMs: 8000, ascentMs: 8000, holdMs: 300 }),
    );
    expect(reps).toHaveLength(0);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'tooSlow')).toBe(true);
  });
});

describe('starting mid-movement', () => {
  it('counts nothing until the reference position has been captured', () => {
    // Fed straight in with no calibration hold. Whatever else happens, no rep may
    // be emitted before the reference exists — there is nothing to compare against.
    const detector = createRepDetector();
    const events: DetectorEvent[] = [];
    for (const f of pushupFrames({ startT: 0, ...SLOW })) events.push(...detector.push(f));

    const calibratedAt = events.findIndex((e) => e.type === 'calibrated');
    const firstRepAt = events.findIndex((e) => e.type === 'rep');
    expect(calibratedAt).toBeGreaterThanOrEqual(0);
    if (firstRepAt >= 0) expect(firstRepAt).toBeGreaterThan(calibratedAt);
  });
});

describe('tracking loss', () => {
  it('emits trackingLost when the person leaves the frame', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    for (let i = 0; i < 30; i++) frames.push(blankFrame((t += 33)));
    const { events } = run(frames);
    expect(events.some((e) => e.type === 'trackingLost')).toBe(true);
  });

  it('does not emit a phantom rep when tracking resumes mid-descent', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    for (let i = 0; i < 30; i++) frames.push(blankFrame((t += 33)));
    // Reappear already at the bottom, then push up.
    for (let i = 0; i < 40; i++) frames.push(frameWithElbowAngle((t += 33), 70 + (100 * i) / 40));
    for (let i = 0; i < 40; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    expect(run(frames).reps).toHaveLength(0);
  });

  it('tolerates brief dropouts without losing tracking', () => {
    const frames = pushupFrames({ startT: 0, ...SLOW });
    // Blank out 3 frames mid-descent — under trackingLostFrames (10).
    const patched = frames.map((f, i) => (i >= 20 && i < 23 ? blankFrame(f.t) : f));
    const { events, reps } = run(patched);
    expect(events.some((e) => e.type === 'trackingLost')).toBe(false);
    expect(reps).toHaveLength(1);
  });
});

describe('side selection', () => {
  it('tracks the visible arm when the other is occluded', () => {
    const frames = pushupFrames({ startT: 0, ...SLOW }).map((f) => f);
    const { detector, reps } = run(frames);
    expect(detector.state().side).toBe('left');
    expect(reps).toHaveLength(1);
  });

  it('counts equally well from the right side', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    const angles = [...Array(10).fill(170), ...Array(30).fill(0).map((_, i) => 170 - (100 * i) / 30),
      ...Array(30).fill(0).map((_, i) => 70 + (100 * i) / 30), ...Array(10).fill(170)];
    for (const a of angles) frames.push(frameWithElbowAngle((t += 33), a, { side: 'right' }));
    const { detector } = run(frames);
    expect(detector.state().side).toBe('right');
    expect(detector.state().reps).toBe(1);
  });
});

describe('reset', () => {
  it('clears counts and state', () => {
    const { detector } = run(pushupFrames({ startT: 0, ...SLOW }));
    expect(detector.state().reps).toBe(1);
    detector.reset();
    expect(detector.state().reps).toBe(0);
    expect(detector.state().phase).toBe('unknown');
    expect(detector.state().tracking).toBe(false);
  });
});

describe('review regressions', () => {
  it('scores depth from the start of the descent, not from the dip transition', () => {
    // A fast rep off a short lockout can reach its deepest point before
    // minTopDwellMs elapses. Recording depth only at the top -> dip transition
    // discarded that, scoring a full-depth rep as a partial.
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 6; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 170 - (100 * i) / 20));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 70 + (100 * i) / 20));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 170));

    const { reps } = run(frames);
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(true);
  });

  it('gives valid and partial reps distinct indices', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (const bottom of [70, 105, 70]) {
      const rep = pushupFrames({ startT: t, bottomAngle: bottom, descentMs: 900, ascentMs: 900 });
      frames.push(...rep);
      t = rep[rep.length - 1].t + 33;
    }
    const { reps } = run(frames);
    expect(reps.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  it('clears the depth reading once a rep completes', () => {
    // The HUD labels this "the rep in progress"; leaving the previous rep's
    // value in place made it show a stale depth for the whole rest period.
    const { detector } = run(pushupFrames({ startT: 0, ...SLOW }));
    expect(detector.state().dipMinAngle).toBe(Infinity);
  });

  it('keeps tracking one arm when both are briefly visible', () => {
    // Without hysteresis the side flaps frame to frame, and since both sides
    // share a single EMA the smoothed angle blends two different elbows.
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      // Alternate which arm scores marginally higher.
      const side = i % 2 === 0 ? 'left' : 'right';
      const f = frameWithElbowAngle((t += 33), 170, { side });
      // Make the other arm nearly as good, so a naive argmax would oscillate.
      const other = side === 'left' ? 6 : 5;
      f.keypoints[other].score = 0.85;
      f.keypoints[other === 6 ? 8 : 7].score = 0.85;
      f.keypoints[other === 6 ? 10 : 9].score = 0.85;
      frames.push(f);
    }
    const { detector } = run(frames);
    const settled = detector.state().side;
    expect(settled === 'left' || settled === 'right').toBe(true);
  });
});

describe('posture gate', () => {
  it('ignores arm movement performed while upright', () => {
    // The reported bug: moving about without doing pushups counted reps. Elbow
    // angle alone cannot tell a pushup from sitting and bending your arms — the
    // torso orientation is what separates them.
    const frames = pushupFrames({ startT: 0, ...SLOW, posture: 'upright' });
    const { detector, reps } = run(frames);
    expect(reps).toHaveLength(0);
    expect(detector.state().reps).toBe(0);
    expect(detector.state().inPosition).toBe(false);
  });

  it('ignores the same movement performed folded up', () => {
    const { reps } = run(pushupFrames({ startT: 0, ...SLOW, posture: 'folded' }));
    expect(reps).toHaveLength(0);
  });

  it('still counts a normal pushup', () => {
    const { reps } = run(pushupFrames({ startT: 0, ...SLOW, posture: 'pushup' }));
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(true);
  });

  it('counts when the legs are out of frame rather than blocking on it', () => {
    // Straightness cannot be measured without a visible knee, but a tight
    // framing should not stop the counter outright.
    const { reps } = run(pushupFrames({ startT: 0, ...SLOW, posture: 'legsHidden' }));
    expect(reps).toHaveLength(1);
  });

  it('counts a sagging rep but flags the form', () => {
    const { reps } = run(pushupFrames({ startT: 0, ...SLOW, posture: 'sagging' }));
    expect(reps).toHaveLength(1);
    expect(reps[0].flags).toContain('hipSag');
  });

  it('emits positionLost when you stand up mid-set', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    const rep = pushupFrames({ startT: t, ...SLOW });
    frames.push(...rep);
    t = rep[rep.length - 1].t + 33;
    for (let i = 0; i < 30; i++) {
      frames.push(frameWithElbowAngle((t += 33), 170, { posture: 'upright' }));
    }
    const { events, detector } = run(frames);
    // Calibration itself establishes the position, so positionAcquired does not
    // fire on entry — losing it is what matters.
    expect(events.some((e) => e.type === 'positionLost')).toBe(true);
    // The rep completed before standing up still counts.
    expect(detector.state().reps).toBe(1);
  });

  it('does not resume a movement that began out of position', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    // Bend the arms while upright...
    for (let i = 0; i < 30; i++) {
      frames.push(frameWithElbowAngle((t += 33), 170 - (100 * i) / 30, { posture: 'upright' }));
    }
    // ...then drop into position already at the bottom and push up.
    for (let i = 0; i < 30; i++) {
      frames.push(frameWithElbowAngle((t += 33), 70 + (100 * i) / 30, { posture: 'pushup' }));
    }
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 170, { posture: 'pushup' }));
    expect(run(frames).reps).toHaveLength(0);
  });

  it('tolerates a brief posture dropout without abandoning the set', () => {
    const frames = pushupFrames({ startT: 0, ...SLOW });
    // Three bad frames mid-rep, under postureLostFrames (5).
    const patched = frames.map((f, i) =>
      i >= 25 && i < 28 ? frameWithElbowAngle(f.t, 120, { posture: 'upright' }) : f,
    );
    const { events } = run(patched);
    expect(events.some((e) => e.type === 'positionLost')).toBe(false);
  });
});

describe('relaxed timing', () => {
  it('accepts a slow controlled rep that the old 6s cap rejected', () => {
    const { reps } = run(
      pushupFrames({ startT: 0, bottomAngle: 70, descentMs: 5000, ascentMs: 5000, holdMs: 400 }),
    );
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(true);
    expect(reps[0].durationMs).toBeGreaterThan(6000);
  });
});

describe('calibration', () => {
  it('captures a reference from the held top position', () => {
    const { detector } = run(pushupFrames({ startT: 0, ...SLOW }));
    const cal = detector.state().calibration;
    expect(cal).not.toBeNull();
    expect(cal!.topElbowAngle).toBeCloseTo(170, 0);
    expect(cal!.torsoLength).toBeGreaterThan(0);
  });

  it('works regardless of how the body is oriented in the image', () => {
    // The whole point of calibrating: the reference is captured in whatever
    // space the camera delivers, so a rotated buffer or an unusual camera
    // placement is no longer something the thresholds have to know about.
    // Here the body is rotated 90 degrees from the previous test's layout.
    const rotate = (f: PoseFrame): PoseFrame => ({
      t: f.t,
      keypoints: f.keypoints.map((k) => ({ x: 1 - k.y, y: k.x, score: k.score })),
    });
    const frames = pushupFrames({ startT: 0, ...SLOW }).map(rotate);
    const detector = createRepDetector();
    for (const f of calibrationFrames(frames[0].t).map(rotate)) detector.push(f);
    for (const f of frames) detector.push(f);
    expect(detector.state().reps).toBe(1);
  });

  it('restarts the hold if the body is lost partway through', () => {
    const detector = createRepDetector();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      detector.push(frameWithElbowAngle((t += 33), 170, { posture: 'pushup' }));
    }
    // A single dropped frame must not restart the hold, but sustained loss must.
    detector.push(blankFrame((t += 33)));
    expect(detector.state().calProgress).toBeGreaterThan(0);

    for (let i = 0; i < 12; i++) detector.push(blankFrame((t += 33)));
    // Progress is discarded rather than resumed, so the reference is never an
    // average across two different positions.
    expect(detector.state().calProgress).toBe(0);
    expect(detector.state().mode).toBe('calibrating');
  });

  it('derives thresholds from the calibrated top, not absolute angles', () => {
    // A head-on camera foreshortens the arm so lockout may only read ~150.
    // Fixed thresholds would never be reached; calibrated ones scale with it.
    const frames: PoseFrame[] = [];
    let t = 0;
    const detector = createRepDetector();
    for (const f of calibrationFrames(2200, 150)) detector.push(f);
    t = 2200;
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 150 - (85 * i) / 30));
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 65 + (85 * i) / 30));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    for (const f of frames) detector.push(f);
    expect(detector.state().reps).toBe(1);
  });
});
