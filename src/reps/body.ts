/**
 * Whole-body measurements used to recognise a pushup position.
 *
 * These are deliberately expressed in whatever coordinate space the camera
 * delivers, and are never compared against absolute expectations. The previous
 * approach assumed "a pushup means the torso is horizontal in the image", which
 * silently depends on three independent things lining up: how the phone is
 * placed, which way it is rotated, and whether the frame buffer is delivered in
 * sensor or display orientation. On a portrait phone the buffer arrives
 * landscape, so a perfect plank measured as 76-87 degrees from horizontal and
 * the gate never opened.
 *
 * Instead these measurements are captured once from the user's own setup and
 * everything afterwards is relative to that reference.
 */

import { KEYPOINT, type Keypoint, type PoseFrame } from '../pose/keypoints';
import { distance } from './geometry';

export type BodyMeasurement = {
  ok: boolean;
  /** Direction of the shoulder→hip axis, degrees in (-180, 180]. */
  torsoDir: number;
  /** Distance between the shoulders, or 0 when only one is visible. */
  shoulderWidth: number;
  /** Length of the shoulder→hip axis. */
  torsoLength: number;
};

/** Midpoint of two joints, falling back to whichever one is confident. */
function midpoint(a: Keypoint, b: Keypoint, minConfidence: number): Keypoint | null {
  'worklet';
  const aOk = a != null && a.score >= minConfidence;
  const bOk = b != null && b.score >= minConfidence;
  if (aOk && bOk) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, score: Math.min(a.score, b.score) };
  }
  // A side-on view occludes one shoulder and one hip entirely, so a single
  // confident joint has to be enough.
  if (aOk) return a;
  if (bOk) return b;
  return null;
}

export function measureBody(frame: PoseFrame, minConfidence: number): BodyMeasurement {
  'worklet';
  const kp = frame.keypoints;
  const shoulder = midpoint(kp[KEYPOINT.LEFT_SHOULDER], kp[KEYPOINT.RIGHT_SHOULDER], minConfidence);
  const hip = midpoint(kp[KEYPOINT.LEFT_HIP], kp[KEYPOINT.RIGHT_HIP], minConfidence);

  if (shoulder == null || hip == null) {
    return { ok: false, torsoDir: NaN, shoulderWidth: 0, torsoLength: 0 };
  }

  const torsoLength = distance(shoulder, hip);
  if (torsoLength === 0) {
    return { ok: false, torsoDir: NaN, shoulderWidth: 0, torsoLength: 0 };
  }

  const left = kp[KEYPOINT.LEFT_SHOULDER];
  const right = kp[KEYPOINT.RIGHT_SHOULDER];
  const bothShoulders =
    left != null && right != null && left.score >= minConfidence && right.score >= minConfidence;

  return {
    ok: true,
    torsoDir: (Math.atan2(hip.y - shoulder.y, hip.x - shoulder.x) * 180) / Math.PI,
    shoulderWidth: bothShoulders ? distance(left, right) : 0,
    torsoLength,
  };
}

/**
 * Smallest absolute difference between two directions, in degrees, 0..180.
 *
 * Plain subtraction is wrong across the ±180 wrap: a torso at 179° and one at
 * -179° are two degrees apart, not 358.
 */
export function angleDifference(a: number, b: number): number {
  'worklet';
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/** Median of a numeric array. Mutates a copy, not the input. */
export function median(values: number[]): number {
  'worklet';
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
