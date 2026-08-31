import { describe, expect, it } from 'vitest';
import { counterRotate, isQuarterTurn } from './orientation';

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
