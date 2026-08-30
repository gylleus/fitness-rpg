/**
 * Pure 2D geometry for pose analysis.
 *
 * Deliberately dependency-free: no React, no camera, no native modules. Everything
 * here runs identically in a camera worklet and in a Node test process, which is what
 * lets the rep detector be tuned against recorded fixtures on a laptop.
 *
 * Two constraints apply here because the rep detector calls these from the camera
 * thread, and neither is enforced by TypeScript, ESLint, or the Node tests:
 *
 * 1. Every function carries the 'worklet' directive. Without it the function stays
 *    on the JS thread and the call fails with "tried to synchronously call a Remote
 *    Function".
 * 2. A worklet must be DEFINED ABOVE any worklet in this file that calls it. The
 *    Babel plugin rewrites hoisted `function` declarations into plain assignments,
 *    so an ordinary forward reference — legal JavaScript everywhere else — captures
 *    `undefined` and fails with "undefined is not a function".
 *
 * Coordinates are normalised to 0..1 of the frame. Note that image y grows *downward*,
 * but since every function here is orientation-agnostic that never matters.
 */

export type Point2 = { x: number; y: number };

/** Squared distance. Prefer this over `distance` when only comparing magnitudes. */
export function distanceSquared(a: Point2, b: Point2): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Point2, b: Point2): number {
  'worklet';
  return Math.sqrt(distanceSquared(a, b));
}

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return value < min ? min : value > max ? max : value;
}

/**
 * Absolute angle of the vector a→b away from horizontal, in degrees, 0..90.
 *
 * 0 means the two points lie side by side, 90 means one is directly above the
 * other. Used to tell a pushup (torso roughly horizontal in frame) from standing
 * or sitting, which is what stops arm movement alone from counting as a rep.
 *
 * Returns NaN for coincident points, since the direction is then undefined.
 */
export function angleFromHorizontalDeg(a: Point2, b: Point2): number {
  'worklet';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return NaN;
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
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
  'worklet';
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

/**
 * Exponential moving average, used to smooth per-frame angle jitter from the pose
 * model. `alpha` is the weight of the new sample: 1 is no smoothing, values near 0
 * are heavy smoothing (and heavy lag, which shows up as late rep transitions).
 *
 * A NaN `previous` starts the series at `next`, so a detector recovering from lost
 * tracking resumes cleanly instead of poisoning every later sample with NaN.
 */
export function ema(previous: number, next: number, alpha: number): number {
  'worklet';
  if (!Number.isFinite(previous)) return next;
  return previous + alpha * (next - previous);
}
