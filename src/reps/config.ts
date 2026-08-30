/**
 * Rep detection thresholds.
 *
 * These are starting values, not settled ones. They get tuned against recorded
 * fixtures (see test/fixtures) rather than by guessing — the dev replay screen
 * exists precisely so a change here can be re-scored against every past session.
 */
export type DetectorConfig = {
  /** Elbow angle at or above which the arm counts as locked out at the top. */
  upAngle: number;
  /** Elbow angle at or below which the descent counts as a full-depth rep. */
  downAngle: number;
  /**
   * Elbow angle that marks the start of a descent. The gap between this and
   * `upAngle` is the hysteresis band: without it, jitter around a single
   * threshold would count several reps per rep.
   */
  dipAngle: number;
  /** Keypoints scoring below this are treated as absent. */
  minConfidence: number;
  /** EMA weight for the new sample. Lower = smoother but laggier. */
  emaAlpha: number;
  /** Minimum time held at the top before a new descent can begin. */
  minTopDwellMs: number;
  /** Reps faster than this are physically implausible — jitter, not movement. */
  minRepMs: number;
  /** Reps slower than this are a rest, not a rep. */
  maxRepMs: number;
  /** Consecutive unusable frames before tracking is declared lost. */
  trackingLostFrames: number;

  /**
   * Maximum tilt of the shoulder→hip line away from horizontal, in degrees,
   * for the body to count as being in a pushup position.
   *
   * This is the gate that stops arm movement alone from being counted. Standing
   * or sitting puts the torso near vertical (~90), so anything you do with your
   * elbows while upright is ignored.
   */
  maxTorsoTiltDeg: number;

  /**
   * Minimum shoulder→hip→knee angle for the body to count as extended. Below
   * this you are folded up rather than in a plank, so it is not a pushup.
   * Only applied when the knee is actually visible.
   */
  minBodyLineAngle: number;

  /**
   * Below this the body is in position but sagging. Reps still count; they are
   * flagged so the UI can say why the rep was poor.
   */
  hipSagAngle: number;

  /**
   * Consecutive out-of-position frames tolerated before counting is suspended.
   * A couple of frames of bad hip tracking should not abandon a set.
   */
  postureLostFrames: number;
};

export const DEFAULT_CONFIG: DetectorConfig = {
  upAngle: 150,
  downAngle: 95,
  dipAngle: 110,
  minConfidence: 0.3,
  emaAlpha: 0.4,
  // The timing guards were originally tight because they were the only defence
  // against stray movement being counted. The posture gate now does that job
  // properly, so these can be loose enough to accept a genuinely slow, controlled
  // rep instead of rejecting it.
  minTopDwellMs: 80,
  minRepMs: 300,
  maxRepMs: 12000,
  trackingLostFrames: 10,
  maxTorsoTiltDeg: 45,
  minBodyLineAngle: 130,
  hipSagAngle: 155,
  postureLostFrames: 5,
};
