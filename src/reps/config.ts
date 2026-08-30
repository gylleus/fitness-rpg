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
};

export const DEFAULT_CONFIG: DetectorConfig = {
  upAngle: 150,
  downAngle: 95,
  dipAngle: 110,
  minConfidence: 0.3,
  emaAlpha: 0.4,
  minTopDwellMs: 150,
  minRepMs: 400,
  maxRepMs: 6000,
  trackingLostFrames: 10,
};
