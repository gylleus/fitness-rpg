import { describe, expect, it } from 'vitest';
import {
  applyOverlayTransform,
  counterRotate,
  isQuarterTurn,
  OVERLAY_TRANSFORMS,
  transformSwapsAxes,
} from './orientation';

describe('counterRotate', () => {
  it('leaves an already-upright frame alone', () => {
    expect(counterRotate(0.3, 0.7, 'up')).toEqual({ x: 0.3, y: 0.7 });
  });

  it('undoes a 180 degree rotation', () => {
    expect(counterRotate(0.25, 0.75, 'down')).toEqual({ x: 0.75, y: 0.25 });
  });

  it('is its own inverse for 180 degrees', () => {
    const once = counterRotate(0.2, 0.9, 'down');
    const back = counterRotate(once.x, once.y, 'down');
    expect(back.x).toBeCloseTo(0.2);
    expect(back.y).toBeCloseTo(0.9);
  });

  it('puts the top of a right-rotated frame back at the top', () => {
    // Content rotated 90 right means what was top is now on the right edge.
    // A point on the right edge must come back to the top.
    const back = counterRotate(1, 0.5, 'right');
    expect(back.y).toBeCloseTo(0);
  });

  it('puts the top of a left-rotated frame back at the top', () => {
    // Rotated 90 left means what was top is now on the left edge.
    const back = counterRotate(0, 0.5, 'left');
    expect(back.y).toBeCloseTo(0);
  });

  it('does not vertically mirror an upright head', () => {
    // The reported bug: the head box appeared at the bottom of the screen when
    // the head was up. A point near the top must stay near the top.
    for (const o of ['up', 'right', 'left'] as const) {
      const head = counterRotate(o === 'right' ? 1 : o === 'left' ? 0 : 0.5, o === 'up' ? 0.1 : 0.5, o);
      expect(head.y).toBeLessThan(0.5);
    }
  });

  it('round-trips left and right against each other', () => {
    const r = counterRotate(0.3, 0.8, 'right');
    const back = counterRotate(r.x, r.y, 'left');
    expect(back.x).toBeCloseTo(0.3);
    expect(back.y).toBeCloseTo(0.8);
  });
});

describe('isQuarterTurn', () => {
  it('is true only for the sideways orientations', () => {
    expect(isQuarterTurn('left')).toBe(true);
    expect(isQuarterTurn('right')).toBe(true);
    expect(isQuarterTurn('up')).toBe(false);
    expect(isQuarterTurn('down')).toBe(false);
  });
});

describe('applyOverlayTransform', () => {
  const HEAD_TOP = { x: 0.5, y: 0.05 };
  const HEAD_BOTTOM = { x: 0.5, y: 0.95 };

  it('identity leaves a point alone', () => {
    expect(applyOverlayTransform(0.3, 0.7, 'identity')).toEqual({ x: 0.3, y: 0.7 });
  });

  it('flipY moves a bottom point to the top', () => {
    // The observed situation: the head sits near y=1 in model space but belongs
    // at the top of the screen.
    const out = applyOverlayTransform(HEAD_BOTTOM.x, HEAD_BOTTOM.y, 'flipY');
    expect(out.y).toBeCloseTo(0.05);
    expect(out.x).toBeCloseTo(0.5);
  });

  it('every transform is a bijection of the unit square', () => {
    for (const t of OVERLAY_TRANSFORMS) {
      const out = applyOverlayTransform(0.25, 0.75, t);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.x).toBeLessThanOrEqual(1);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeLessThanOrEqual(1);
    }
  });

  it('offers a distinct mapping for each of the eight cases', () => {
    const seen = new Set(
      OVERLAY_TRANSFORMS.map((t) => {
        const o = applyOverlayTransform(0.2, 0.7, t);
        return `${o.x.toFixed(3)},${o.y.toFixed(3)}`;
      }),
    );
    expect(seen.size).toBe(OVERLAY_TRANSFORMS.length);
  });

  it('marks exactly the quarter turns as axis-swapping', () => {
    const swapping = OVERLAY_TRANSFORMS.filter(transformSwapsAxes);
    expect(swapping).toEqual(['rot90', 'rot90flip', 'rot270', 'rot270flip']);
  });

  it('keeps a head at the top where it already is under identity', () => {
    const out = applyOverlayTransform(HEAD_TOP.x, HEAD_TOP.y, 'identity');
    expect(out.y).toBeLessThan(0.5);
  });
});
