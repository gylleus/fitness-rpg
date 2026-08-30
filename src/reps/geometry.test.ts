import { describe, expect, it } from 'vitest';
import { angleDeg, clamp, distance, distanceSquared, ema } from './geometry';

describe('angleDeg', () => {
  it('measures a right angle at the vertex', () => {
    expect(angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });

  it('measures a straight arm as 180 degrees', () => {
    expect(angleDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
  });

  it('measures a fully folded arm as 0 degrees', () => {
    expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(0);
  });

  it('is invariant to scale — the whole point of using angles', () => {
    const small = angleDeg({ x: 0, y: 0.1 }, { x: 0, y: 0 }, { x: 0.1, y: 0.05 });
    const large = angleDeg({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 5 });
    expect(small).toBeCloseTo(large);
  });

  it('is invariant to translation', () => {
    const atOrigin = angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    const shifted = angleDeg({ x: 5, y: 8 }, { x: 5, y: 7 }, { x: 6, y: 7 });
    expect(atOrigin).toBeCloseTo(shifted);
  });

  it('is invariant to rotation — a pushup is filmed sideways', () => {
    const upright = angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    const rotated = angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -1 });
    expect(upright).toBeCloseTo(rotated);
  });

  it('does not return NaN for a perfectly straight arm', () => {
    // Collinear points can push the cosine quotient past 1.0 through float drift,
    // which would make acos return NaN for the single most common pose.
    const straight = angleDeg({ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.5 });
    expect(Number.isNaN(straight)).toBe(false);
    expect(straight).toBeCloseTo(180);
  });

  it('returns NaN when the angle is genuinely undefined', () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNaN();
  });

  it('stays within [0, 180] across many random inputs', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const a = angleDeg(
        { x: rand(), y: rand() },
        { x: rand(), y: rand() },
        { x: rand(), y: rand() },
      );
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(180);
    }
  });
});

describe('distance', () => {
  it('computes euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('agrees with the squared form', () => {
    expect(distanceSquared({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });
});

describe('clamp', () => {
  it('bounds values on both sides and passes through the middle', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('ema', () => {
  it('with alpha 1 returns the new sample unchanged', () => {
    expect(ema(0, 100, 1)).toBe(100);
  });

  it('moves partway toward the new sample', () => {
    expect(ema(0, 100, 0.4)).toBeCloseTo(40);
  });

  it('converges toward a constant input', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = ema(v, 180, 0.4);
    expect(v).toBeCloseTo(180);
  });

  it('recovers from NaN rather than propagating it', () => {
    // After tracking is lost the running average is NaN; the next good sample
    // must restart the series or every subsequent frame stays NaN forever.
    expect(ema(NaN, 90, 0.4)).toBe(90);
  });
});
