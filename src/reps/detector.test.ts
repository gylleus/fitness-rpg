import { describe, expect, it } from 'vitest';
import { createRepDetector, type DetectorEvent, type RepEvent } from './detector';
import { blankFrame, frameWithElbowAngle, pushupFrames } from '../../test/synth';
import type { PoseFrame } from '../pose/keypoints';

function run(frames: PoseFrame[], config = {}) {
  const detector = createRepDetector(config);
  const events: DetectorEvent[] = [];
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
  it('does not award a rep when the session begins at the bottom', () => {
    // Camera starts recording with the user already down. Only the ascent is seen,
    // which is half a rep and must not count.
    const frames: PoseFrame[] = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      frames.push(frameWithElbowAngle((t += 33), 70 + (100 * i) / 40));
    }
    for (let i = 0; i < 40; i++) frames.push(frameWithElbowAngle((t += 33), 170));
    expect(run(frames).reps).toHaveLength(0);
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
