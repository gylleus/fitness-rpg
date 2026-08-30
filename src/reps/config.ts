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

  /** How long the top position must be held to capture a reference, in ms. */
  calibrationMs: number;
  /** Minimum usable samples before a calibration is accepted. */
  calibrationMinSamples: number;
  /**
   * How far the torso may rotate away from the calibrated reference before the
   * body no longer counts as being in position, in degrees.
   */
  torsoToleranceDeg: number;
  /**
   * How much the torso may grow or shrink relative to the calibrated reference.
   * Catches standing up or walking away, which change apparent scale sharply,
   * without punishing the normal movement of a rep.
   */
  minScaleRatio: number;
  maxScaleRatio: number;

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
  calibrationMs: 1500,
  calibrationMinSamples: 12,
  // Generous: a real rep rotates the torso somewhat, and a head-on view makes
  // the measured direction noisy because the torso is heavily foreshortened.
  torsoToleranceDeg: 40,
  minScaleRatio: 0.6,
  maxScaleRatio: 1.7,
  minBodyLineAngle: 130,
  hipSagAngle: 155,
  postureLostFrames: 5,
};
