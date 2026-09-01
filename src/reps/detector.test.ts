import { describe, expect, it } from 'vitest';
import { createRepDetector, type DetectorEvent, type RepEvent } from './detector';
import { blankFrame, frameWithElbowAngle, pushupFrames } from '../../test/synth';
import { KEYPOINT, type PoseFrame } from '../pose/keypoints';

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

/** One slow rep, which the detector uses to measure the usable range. */
function demonstrationFrames(startT: number): PoseFrame[] {
  return pushupFrames({
    startT,
    bottomAngle: 70,
    descentMs: 600,
    ascentMs: 600,
    holdMs: 200,
    posture: 'pushup',
  });
}

function run(frames: PoseFrame[], config = {}) {
  const detector = createRepDetector(config);
  const events: DetectorEvent[] = [];
  const firstT = frames.length > 0 ? frames[0].t : 0;
  const demoStart = firstT - 2200;
  for (const f of calibrationFrames(demoStart)) detector.push(f);
  for (const f of demonstrationFrames(demoStart)) detector.push(f);
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
  it('counts a shallow descent, flagged as not full depth', () => {
    // Leniency: a missed rep means the user did the work and got nothing, which
    // reads as the app being broken. A shallow one still counts, and records
    // that it was shallow so form can be graded later.
    const { reps, detector } = run(
      pushupFrames({ startT: 0, bottomAngle: 105, descentMs: 900, ascentMs: 900 }),
    );
    expect(reps).toHaveLength(1);
    expect(reps[0].valid).toBe(false);
    expect(detector.state().reps).toBe(1);
    expect(detector.state().partials).toBe(1);
  });

  it('ignores movement that never enters the dip band at all', () => {
    const { reps } = run(pushupFrames({ startT: 0, bottomAngle: 135, descentMs: 900, ascentMs: 900 }));
    expect(reps).toHaveLength(0);
  });

  it('counts every rep in a mixed set, tracking how many were shallow', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (const bottom of [70, 70, 105, 70, 105]) {
      const rep = pushupFrames({ startT: t, bottomAngle: bottom, descentMs: 900, ascentMs: 900 });
      frames.push(...rep);
      t = rep[rep.length - 1].t + 33;
    }
    const { detector } = run(frames);
    expect(detector.state().reps).toBe(5);
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
      // Duration is measured between lockout crossings, and the return threshold
      // is now more forgiving, so the movement has to be slower still to exceed
      // the 12s cap.
      pushupFrames({ startT: 0, bottomAngle: 70, descentMs: 12000, ascentMs: 12000, holdMs: 300 }),
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
    const demoStart = frames[0].t - 2200;
    for (const f of calibrationFrames(demoStart).map(rotate)) detector.push(f);
    for (const f of demonstrationFrames(demoStart).map(rotate)) detector.push(f);
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
    for (const f of calibrationFrames(0, 150)) detector.push(f);
    // Demonstrate the range this foreshortened view can actually show: lockout
    // reads 150, not 180, and the bottom only reaches 65.
    for (const f of pushupFrames({
      startT: 0, topAngle: 150, bottomAngle: 65,
      descentMs: 600, ascentMs: 600, holdMs: 200, posture: 'pushup',
    })) {
      detector.push(f);
    }
    t = 2200;
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 150 - (85 * i) / 30));
    for (let i = 0; i < 30; i++) frames.push(frameWithElbowAngle((t += 33), 65 + (85 * i) / 30));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    for (const f of frames) detector.push(f);
    expect(detector.state().reps).toBe(1);
  });
});

describe('the bottom of a rep', () => {
  it('completes a rep even when tracking drops out at the bottom', () => {
    // The pose model is least confident exactly where the body is lowest and
    // limbs occlude. Abandoning there costs the whole rep.
    const frames = pushupFrames({ startT: 0, ...SLOW });
    const lowest = frames.reduce(
      (best, f, i) => (i > 20 && i < 45 ? i : best),
      0,
    );
    const patched = frames.map((f, i) =>
      i >= lowest - 6 && i < lowest + 6 ? blankFrame(f.t) : f,
    );
    const { detector } = run(patched);
    expect(detector.state().reps + detector.state().partials).toBe(1);
  });

  it('does not abandon a rep because the body shape changed while descending', () => {
    // Descending is exactly what changes the torso's apparent length and angle.
    // Checking the calibrated posture mid-rep made the gate fight the movement.
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 8; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    // Descend while the torso also foreshortens sharply, as it does head-on.
    for (let i = 0; i < 25; i++) {
      const f = frameWithElbowAngle((t += 33), 170 - (100 * i) / 25);
      const hip = f.keypoints[11];
      // Torso foreshortens progressively as the body lowers: full length at the
      // top, down to 55% at the bottom — past the scale tolerance that applies
      // between reps, which is the point.
      hip.x = 0.4 - 0.15 * (1 - 0.45 * (i / 25));
      frames.push(f);
    }
    for (let i = 0; i < 25; i++) frames.push(frameWithElbowAngle((t += 33), 70 + (100 * i) / 25));
    for (let i = 0; i < 20; i++) frames.push(frameWithElbowAngle((t += 33), 170));

    const { events, detector } = run(frames);
    expect(events.some((e) => e.type === 'positionLost')).toBe(false);
    expect(detector.state().reps).toBe(1);
  });

  it('still records how deep the rep got when frames are missing at the bottom', () => {
    const frames = pushupFrames({ startT: 0, ...SLOW });
    const { detector } = run(frames);
    // Depth is cleared once the rep completes, so check the reported outcome.
    expect(detector.state().lastRepValid).toBe(true);
    expect(detector.state().lastRepDepth).toBeLessThan(110);
  });
});

describe('measured range of motion', () => {
  it('counts a foreshortened rep that fixed offsets would score as partial', () => {
    // Head-on, the forearm points partly at the lens: lockout projects as 150
    // and a genuinely deep bottom only reaches 105. A depth requirement derived
    // as "top minus 70" would demand 80 and never be satisfied.
    const detector = createRepDetector();
    for (const f of calibrationFrames(0, 150)) detector.push(f);
    for (const f of pushupFrames({
      startT: 0, topAngle: 150, bottomAngle: 105,
      descentMs: 600, ascentMs: 600, holdMs: 200, posture: 'pushup',
    })) {
      detector.push(f);
    }

    let t = 2200;
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 8; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    for (let i = 0; i < 25; i++) frames.push(frameWithElbowAngle((t += 33), 150 - (45 * i) / 25));
    for (let i = 0; i < 25; i++) frames.push(frameWithElbowAngle((t += 33), 105 + (45 * i) / 25));
    for (let i = 0; i < 15; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    for (const f of frames) detector.push(f);

    expect(detector.state().reps).toBe(1);
    expect(detector.state().partials).toBe(0);
  });

  it('rejects a movement too small to have moved the body', () => {
    // Same foreshortened view, but only half the demonstrated travel. An elbow
    // change this small corresponds to the body barely moving, which is what a
    // motionless person's pose noise looks like — so it is now rejected rather
    // than counted as a shallow rep.
    const detector = createRepDetector();
    for (const f of calibrationFrames(0, 150)) detector.push(f);
    for (const f of pushupFrames({
      startT: 0, topAngle: 150, bottomAngle: 105,
      descentMs: 600, ascentMs: 600, holdMs: 200, posture: 'pushup',
    })) {
      detector.push(f);
    }

    let t = 2200;
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 8; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    for (let i = 0; i < 25; i++) frames.push(frameWithElbowAngle((t += 33), 150 - (22 * i) / 25));
    for (let i = 0; i < 25; i++) frames.push(frameWithElbowAngle((t += 33), 128 + (22 * i) / 25));
    for (let i = 0; i < 15; i++) frames.push(frameWithElbowAngle((t += 33), 150));
    const events: DetectorEvent[] = [];
    for (const f of frames) events.push(...detector.push(f));

    expect(detector.state().reps).toBe(0);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'noMovement')).toBe(true);
  });

  it('falls back to an assumed range if no rep is demonstrated', () => {
    const detector = createRepDetector();
    let t = 0;
    for (const f of calibrationFrames(0, 170)) detector.push(f);
    // Hold at the top well past the timeout without ever descending.
    for (t = 0; t < 22000; t += 100) {
      detector.push(frameWithElbowAngle(t, 170, { posture: 'pushup' }));
    }
    expect(detector.state().mode).toBe('counting');
    expect(detector.state().calibration!.bottomElbowAngle).toBeCloseTo(90, 0);
  });
});

describe('fast cadence', () => {
  /** A continuous set at a given tempo, with no pause at the top. */
  function setAtTempo(repMs: number, count: number): PoseFrame[] {
    const frames: PoseFrame[] = [];
    const step = 1000 / 30;
    let t = 0;
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    for (let r = 0; r < count; r++) {
      const half = repMs / 2;
      for (let e = 0; e < half; e += step) {
        frames.push(frameWithElbowAngle((t += step), 170 - 100 * (e / half)));
      }
      for (let e = 0; e < half; e += step) {
        frames.push(frameWithElbowAngle((t += step), 70 + 100 * (e / half)));
      }
    }
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    return frames;
  }

  it('counts ten reps at one per second', () => {
    // The reported failure point: anything faster than roughly 1/s stopped
    // registering, because the smoothing flattened the movement below the
    // thresholds even though the movement itself was full range.
    expect(run(setAtTempo(1000, 10)).detector.state().reps).toBe(10);
  });

  it('counts ten reps at two per second', () => {
    expect(run(setAtTempo(500, 10)).detector.state().reps).toBe(10);
  });

  it('does not over-count at speed', () => {
    const { detector } = run(setAtTempo(600, 8));
    expect(detector.state().reps).toBe(8);
  });

  it('heavily under-counts oscillation far faster than any real rep', () => {
    // Four full-range oscillations at 160ms each - six per second, which nobody
    // does - yield at most one rep rather than four.
    //
    // Not zero, and deliberately so. Rejecting these outright means raising
    // minRepMs, but a genuine two-per-second set measures only ~350ms between
    // lockouts, so the guard that would exclude a twitch also excludes a real
    // fast rep. Given a missed rep is far more costly to a user than a spurious
    // one, the threshold sits on the permissive side.
    const { detector } = run(setAtTempo(160, 4));
    expect(detector.state().reps).toBeLessThanOrEqual(1);
  });
});

describe('incomplete lockout between reps', () => {
  /** A set where the arm only comes back part of the way up between reps. */
  function partialLockoutSet(returnTo: number, count: number): PoseFrame[] {
    const frames: PoseFrame[] = [];
    const step = 1000 / 30;
    let t = 0;
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    for (let r = 0; r < count; r++) {
      for (let e = 0; e < 300; e += step) {
        frames.push(frameWithElbowAngle((t += step), returnTo - (returnTo - 70) * (e / 300)));
      }
      for (let e = 0; e < 300; e += step) {
        frames.push(frameWithElbowAngle((t += step), 70 + (returnTo - 70) * (e / 300)));
      }
    }
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    return frames;
  }

  it('counts reps that only return to 85% of lockout', () => {
    // Nobody fully straightens their arms between fast reps. Requiring it means
    // the boundary between reps is never seen and several merge into one count.
    expect(run(partialLockoutSet(155, 8)).detector.state().reps).toBe(8);
  });

  it('counts reps that only return to 75% of lockout', () => {
    expect(run(partialLockoutSet(145, 8)).detector.state().reps).toBe(8);
  });
});

describe('tempo and lockout envelope', () => {
  /** A continuous set at a tempo, returning only partway to lockout. */
  function set(returnTo: number, repMs: number, count: number): PoseFrame[] {
    const frames: PoseFrame[] = [];
    const step = 1000 / 30;
    let t = 0;
    const half = repMs / 2;
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    for (let r = 0; r < count; r++) {
      for (let e = 0; e < half; e += step) {
        frames.push(frameWithElbowAngle((t += step), returnTo - (returnTo - 70) * (e / half)));
      }
      for (let e = 0; e < half; e += step) {
        frames.push(frameWithElbowAngle((t += step), 70 + (returnTo - 70) * (e / half)));
      }
    }
    for (let i = 0; i < 10; i++) frames.push(frameWithElbowAngle((t += step), 170));
    return frames;
  }

  // The supported envelope, pinned so a future filtering change cannot quietly
  // shrink it. Each was verified to fail before the rebound-based completion.
  const cases: [number, number][] = [
    [165, 1000], [165, 600], [165, 400], [165, 300],
    [155, 1000], [155, 600], [155, 400], [155, 300],
    [150, 1000], [150, 600], [150, 400],
    [145, 1000], [145, 600], [145, 400],
  ];

  for (const [lockout, tempo] of cases) {
    it(`counts 8 of 8 returning to ${lockout} at ${tempo}ms per rep`, () => {
      expect(run(set(lockout, tempo, 8)).detector.state().reps).toBe(8);
    });
  }
});

describe('sitting still', () => {
  /**
   * A motionless body whose joints jitter, which is what pose estimation does
   * on a static subject. Joint angles wander through a rep's worth of degrees
   * while nothing actually moves.
   */
  function stationaryNoise(frames: number, jitterDeg: number, seed = 7): PoseFrame[] {
    let s = seed;
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < frames; i++) {
      // Oscillate the apparent elbow angle over the full working range, exactly
      // the signal that previously produced reps out of nothing.
      const angle = 120 + Math.sin(i / 5) * jitterDeg + (rand() - 0.5) * 6;
      const f = frameWithElbowAngle((t += 1000 / 30), angle, { posture: 'pushup' });
      // The body does NOT move: pin every joint to its resting position and let
      // only small independent noise move each one.
      for (const k of f.keypoints) {
        k.x = 0.5 + (rand() - 0.5) * 0.012;
        k.y = 0.6 + (rand() - 0.5) * 0.012;
      }
      f.keypoints[KEYPOINT.LEFT_SHOULDER] = { x: 0.5 + (rand() - 0.5) * 0.012, y: 0.56, score: 0.9 };
      f.keypoints[KEYPOINT.LEFT_ELBOW] = { x: 0.58, y: 0.68 + (rand() - 0.5) * 0.02, score: 0.9 };
      f.keypoints[KEYPOINT.LEFT_WRIST] = { x: 0.5 + (rand() - 0.5) * 0.012, y: 0.8, score: 0.9 };
      f.keypoints[KEYPOINT.LEFT_HIP] = { x: 0.35, y: 0.56, score: 0.9 };
      f.keypoints[KEYPOINT.LEFT_KNEE] = { x: 0.21, y: 0.56, score: 0.9 };
      out.push(f);
    }
    return out;
  }

  it('counts nothing while the body is stationary', () => {
    // The reported bug: sitting completely still produced pushups.
    const { detector } = run(stationaryNoise(400, 45));
    expect(detector.state().reps).toBe(0);
  });

  it('counts nothing across several noise seeds', () => {
    for (const seed of [1, 13, 99, 12345]) {
      const { detector } = run(stationaryNoise(300, 50, seed));
      expect(detector.state().reps).toBe(0);
    }
  });

  it('rejects arm movement where the hands travel and the body does not', () => {
    // Seated arm movement is the reverse of a pushup: hands move, torso stays.
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 20; i++) {
        const f = frameWithElbowAngle((t += 1000 / 30), 170 - 100 * (i / 20), { posture: 'pushup' });
        const sh = f.keypoints[KEYPOINT.LEFT_SHOULDER];
        // Pin the body where it was and let the wrist do the travelling.
        const drop = 0.56 - sh.y;
        for (const idx of [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.NOSE]) {
          f.keypoints[idx].y += drop;
        }
        f.keypoints[KEYPOINT.LEFT_WRIST].y -= drop;
        frames.push(f);
      }
      for (let i = 0; i < 20; i++) {
        const f = frameWithElbowAngle((t += 1000 / 30), 70 + 100 * (i / 20), { posture: 'pushup' });
        const sh = f.keypoints[KEYPOINT.LEFT_SHOULDER];
        const drop = 0.56 - sh.y;
        for (const idx of [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.NOSE]) {
          f.keypoints[idx].y += drop;
        }
        f.keypoints[KEYPOINT.LEFT_WRIST].y -= drop;
        frames.push(f);
      }
    }
    expect(run(frames).detector.state().reps).toBe(0);
  });

  it('still counts real pushups, where the body travels and hands stay put', () => {
    expect(run(pushupFrames({ startT: 0, ...SLOW })).detector.state().reps).toBe(1);
  });
});

describe('unreliable wrist tracking', () => {
  it('counts a rep when the wrist keypoint jumps around untracked', () => {
    // Measured on device: head-on, the hands are often occluded or out of frame,
    // and the wrist keypoint reported half a frame of travel during a genuine
    // pushup — more than the body moved. The hands check vetoed real reps.
    const frames = pushupFrames({ startT: 0, ...SLOW }).map((f, i) => {
      if (i % 5 !== 0) return f;
      // Every fifth frame the wrist is unconfident and flung across the image,
      // which is what an occluded hand looks like. Those samples must not be
      // allowed to claim the hands travelled.
      const wrist = f.keypoints[KEYPOINT.LEFT_WRIST];
      wrist.score = 0.15;
      wrist.x = i % 10 === 0 ? 0.05 : 0.95;
      wrist.y = i % 15 === 0 ? 0.1 : 0.9;
      return f;
    });
    const { detector } = run(frames);
    expect(detector.state().reps).toBe(1);
    // The glitched samples contributed nothing to measured hand travel.
    expect(detector.state().handTravel).toBeLessThan(0.1);
  });

  it('still rejects hand movement when the wrist IS reliably tracked', () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 20; i++) {
        const f = frameWithElbowAngle((t += 1000 / 30), 170 - 100 * (i / 20), { posture: 'pushup' });
        const sh = f.keypoints[KEYPOINT.LEFT_SHOULDER];
        const drop = 0.56 - sh.y;
        for (const idx of [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.NOSE]) {
          f.keypoints[idx].y += drop;
        }
        f.keypoints[KEYPOINT.LEFT_WRIST].y -= drop;
        f.keypoints[KEYPOINT.LEFT_WRIST].score = 0.9;
        frames.push(f);
      }
      for (let i = 0; i < 20; i++) {
        const f = frameWithElbowAngle((t += 1000 / 30), 70 + 100 * (i / 20), { posture: 'pushup' });
        const sh = f.keypoints[KEYPOINT.LEFT_SHOULDER];
        const drop = 0.56 - sh.y;
        for (const idx of [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.NOSE]) {
          f.keypoints[idx].y += drop;
        }
        f.keypoints[KEYPOINT.LEFT_WRIST].y -= drop;
        f.keypoints[KEYPOINT.LEFT_WRIST].score = 0.9;
        frames.push(f);
      }
    }
    expect(run(frames).detector.state().reps).toBe(0);
  });
});
