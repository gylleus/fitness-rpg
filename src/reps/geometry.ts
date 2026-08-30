/**
 * Pure 2D geometry for pose analysis.
 *
 * Deliberately dependency-free: no React, no camera, no native modules. Everything
 * here runs identically in a camera worklet and in a Node test process, which is what
 * lets the rep detector be tuned against recorded fixtures on a laptop.
 *
 * Coordinates are normalised to 0..1 of the frame. Note that image y grows *downward*,
 * but since every function here is orientation-agnostic that never matters.
 */

export type Point2 = { x: number; y: number };

/** Squared distance. Prefer this over `distance` when only comparing magnitudes. */
export function distanceSquared(a: Point2, b: Point2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Point2, b: Point2): number {
  return Math.sqrt(distanceSquared(a, b));
}

/**
 * Interior angle at vertex `b`, in degrees, in the range [0, 180].
 *
 * This is the core signal for rep counting: the elbow angle (shoulder→elbow→wrist)
 * describes how bent the arm is regardless of how far the phone is from the user,
 * how large they are, or what height the camera sits at. Raw pixel positions carry
 * none of those invariances.
 *
 * Returns NaN if either arm of the angle has zero length, since the angle is then
 * genuinely undefined — callers must treat NaN as "no reading", not as 0°.
 */
export function angleDeg(a: Point2, b: Point2, c: Point2): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return NaN;

  // Clamp guards against floating-point drift pushing the quotient outside
  // acos's domain for near-collinear points, which would otherwise yield NaN
  // for a perfectly straight arm — exactly the case we care most about.
  const cos = clamp((v1x * v2x + v1y * v2y) / (m1 * m2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Exponential moving average, used to smooth per-frame angle jitter from the pose
 * model. `alpha` is the weight of the new sample: 1 is no smoothing, values near 0
 * are heavy smoothing (and heavy lag, which shows up as late rep transitions).
 *
 * A NaN `previous` starts the series at `next`, so a detector recovering from lost
 * tracking resumes cleanly instead of poisoning every later sample with NaN.
 */
export function ema(previous: number, next: number, alpha: number): number {
  if (!Number.isFinite(previous)) return next;
  return previous + alpha * (next - previous);
}
