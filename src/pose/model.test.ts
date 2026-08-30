import { describe, expect, it } from 'vitest';
import {
  createKeypointBuffer,
  decodeMoveNet,
  MODEL_CHANNELS,
  rotateSquareRgb,
  unrotateKeypoints,
  type InputRotation,
} from './model';
import { KEYPOINT, KEYPOINT_COUNT, type Keypoint } from './keypoints';

describe('decodeMoveNet', () => {
  it('reads y before x, matching the model output layout', () => {
    const raw = new Float32Array(KEYPOINT_COUNT * 3);
    raw[0] = 0.25; // nose y
    raw[1] = 0.75; // nose x
    raw[2] = 0.9; // nose score
    const out = createKeypointBuffer();
    decodeMoveNet(raw, out);
    const nose = out[KEYPOINT.NOSE];
    expect(nose.y).toBeCloseTo(0.25);
    expect(nose.x).toBeCloseTo(0.75);
    // Float32Array storage means exact equality does not hold: 0.9 reads back
    // as 0.89999997.
    expect(nose.score).toBeCloseTo(0.9);
  });

  it('fills all 17 keypoints', () => {
    const raw = new Float32Array(KEYPOINT_COUNT * 3).fill(0.5);
    const out = createKeypointBuffer();
    decodeMoveNet(raw, out);
    expect(out).toHaveLength(17);
    expect(out.every((k) => k.score === 0.5)).toBe(true);
  });

  it('does not mistake x for y on an asymmetric pose', () => {
    // A guard against silently swapping the axes: if decode read x first, this
    // skeleton would come out mirrored about the diagonal and still look valid.
    const raw = new Float32Array(KEYPOINT_COUNT * 3);
    raw[KEYPOINT.LEFT_WRIST * 3] = 0.1; // y near the top
    raw[KEYPOINT.LEFT_WRIST * 3 + 1] = 0.9; // x near the right
    raw[KEYPOINT.LEFT_WRIST * 3 + 2] = 1;
    const out = createKeypointBuffer();
    decodeMoveNet(raw, out);
    expect(out[KEYPOINT.LEFT_WRIST].y).toBeLessThan(out[KEYPOINT.LEFT_WRIST].x);
  });

  it('reuses the buffer instead of allocating', () => {
    const out = createKeypointBuffer();
    const first = out[0];
    decodeMoveNet(new Float32Array(KEYPOINT_COUNT * 3).fill(0.1), out);
    expect(out[0]).toBe(first);
  });
});

describe('rotateSquareRgb', () => {
  const SIZE = 4;

  /** Builds a buffer where each pixel's red channel encodes its index. */
  function ramp(size: number): Uint8Array {
    const buf = new Uint8Array(size * size * MODEL_CHANNELS);
    for (let i = 0; i < size * size; i++) {
      buf[i * MODEL_CHANNELS] = i;
      buf[i * MODEL_CHANNELS + 1] = 100 + i;
      buf[i * MODEL_CHANNELS + 2] = 200 - i;
    }
    return buf;
  }

  it('returns the source untouched for 0 degrees', () => {
    const src = ramp(SIZE);
    const dst = new Uint8Array(src.length);
    expect(rotateSquareRgb(src, dst, SIZE, 0)).toBe(src);
  });

  it('moves the top-left pixel to the top-right at 90 degrees', () => {
    const src = ramp(SIZE);
    const dst = new Uint8Array(src.length);
    rotateSquareRgb(src, dst, SIZE, 90);
    // Source index 0 is top-left; after a clockwise quarter turn it is top-right.
    const topRight = (0 * SIZE + (SIZE - 1)) * MODEL_CHANNELS;
    expect(dst[topRight]).toBe(0);
  });

  it('keeps all channels together rather than shearing them', () => {
    const src = ramp(SIZE);
    const dst = new Uint8Array(src.length);
    rotateSquareRgb(src, dst, SIZE, 90);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = dst[i * MODEL_CHANNELS];
      expect(dst[i * MODEL_CHANNELS + 1]).toBe(100 + r);
      expect(dst[i * MODEL_CHANNELS + 2]).toBe(200 - r);
    }
  });

  it('returns to the original after four 90-degree turns', () => {
    let cur = ramp(SIZE);
    for (let i = 0; i < 4; i++) {
      const next = new Uint8Array(cur.length);
      rotateSquareRgb(cur, next, SIZE, 90);
      cur = next;
    }
    expect(Array.from(cur)).toEqual(Array.from(ramp(SIZE)));
  });

  it('180 degrees equals two 90-degree turns', () => {
    const src = ramp(SIZE);
    const once = new Uint8Array(src.length);
    const twice = new Uint8Array(src.length);
    rotateSquareRgb(src, once, SIZE, 90);
    rotateSquareRgb(once, twice, SIZE, 90);
    const direct = new Uint8Array(src.length);
    rotateSquareRgb(src, direct, SIZE, 180);
    expect(Array.from(direct)).toEqual(Array.from(twice));
  });
});

describe('unrotateKeypoints', () => {
  /**
   * Rotating the image then un-rotating the coordinates must be the identity.
   * If it is not, the skeleton is drawn where the person is not — which on a
   * phone looks like a broken model rather than a broken transform.
   */
  for (const rotation of [90, 180, 270] as InputRotation[]) {
    it(`round-trips a ${rotation} degree rotation back to the original point`, () => {
      for (const p of [
        { x: 0.2, y: 0.9 },
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 1.0 },
        { x: 0.5, y: 0.5 },
      ]) {
        // Forward transform: where a frame point lands in the clockwise-rotated image.
        const fwd =
          rotation === 90
            ? { x: 1 - p.y, y: p.x }
            : rotation === 180
              ? { x: 1 - p.x, y: 1 - p.y }
              : { x: p.y, y: 1 - p.x };

        const kp: Keypoint[] = [{ ...fwd, score: 1 }];
        unrotateKeypoints(kp, rotation);
        expect(kp[0].x).toBeCloseTo(p.x, 6);
        expect(kp[0].y).toBeCloseTo(p.y, 6);
      }
    });
  }

  it('maps a known point correctly at 90 degrees', () => {
    // Top-left of the clockwise-rotated image came from the bottom-left of the
    // original: (0, 0) -> (0, 1).
    const kp: Keypoint[] = [{ x: 0, y: 0, score: 1 }];
    unrotateKeypoints(kp, 90);
    expect(kp[0].x).toBeCloseTo(0);
    expect(kp[0].y).toBeCloseTo(1);
  });

  it('preserves scores', () => {
    const kp: Keypoint[] = [{ x: 0.1, y: 0.2, score: 0.42 }];
    unrotateKeypoints(kp, 270);
    expect(kp[0].score).toBe(0.42);
  });
});
