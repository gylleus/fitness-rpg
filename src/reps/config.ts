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
  /**
   * Smoothing time constant in milliseconds, applied after a median-of-three.
   *
   * Kept short deliberately. The filter only has to remove per-frame jitter; the
   * median stage already handles outliers, and heavy averaging flattens fast
   * reps until they stop crossing the thresholds.
   */
  smoothingTauMs: number;
  /**
   * Fastest plausible elbow angular rate, in degrees per second.
   *
   * A two-and-a-half rep per second set moves roughly 500 deg/s, so this leaves
   * generous headroom above real movement while still catching pose-estimation
   * spikes, which are effectively instantaneous.
   */
  maxElbowRateDegPerSec: number;
  /** Minimum time held at the top before a new descent can begin. */
  minTopDwellMs: number;
  /** Reps faster than this are physically implausible — jitter, not movement. */
  minRepMs: number;
  /** Reps slower than this are a rest, not a rep. */
  maxRepMs: number;
  /** Consecutive unusable frames before tracking is declared lost. */
  trackingLostFrames: number;
  /**
   * The same, but while a rep is in progress.
   *
   * The bottom of a pushup is the worst case for the pose model: limbs occlude
   * each other and the body is closest to the floor. Giving up as fast as we do
   * between reps meant the descent was routinely abandoned right at the point
   * that decides whether the rep counts.
   */
  trackingLostFramesInRep: number;

  /** How long the top position must be held to capture a reference, in ms. */
  calibrationMs: number;
  /** Minimum usable samples before a calibration is accepted. */
  calibrationMinSamples: number;
  /** Minimum elbow travel that counts as having demonstrated a full rep. */
  rangeMinTravelDeg: number;
  /** How close to the calibrated top counts as having returned. */
  rangeReturnDeg: number;
  /** Give up waiting for a demonstration rep after this long. */
  rangeTimeoutMs: number;
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

  /**
   * Count a rep even when it did not reach full demonstrated depth.
   *
   * The two failure modes are not symmetric. A missed rep means the user did the
   * work and got nothing, which reads as the app being broken. A spurious rep in
   * a solo tracker costs almost nothing. Tracking is also least reliable exactly
   * where depth is judged — at the bottom — so strictness there converts pose
   * dropouts into lost reps.
   *
   * Depth is still recorded on every rep, so a later grading or form feature has
   * the data without counting ever having depended on it.
   */
  countShallowReps: boolean;

  /**
   * Fraction of the demonstrated range that must be travelled for a movement to
   * register as a rep at all. Below this it is not treated as a rep.
   */
  minTravelFraction: number;
  /** Fraction of the demonstrated range that marks a rep as full depth. */
  fullDepthFraction: number;
  /**
   * How far back toward lockout the arm must come for a rep to be completed,
   * as a fraction of the demonstrated range.
   *
   * A fast set rarely returns to a full lockout between reps. Demanding one
   * means the rep boundary is never detected and several reps merge into a
   * single count — a direct cause of undercounting at speed.
   */
  topReturnFraction: number;
  /**
   * How much of the descent must be undone for the rep to count as finished,
   * as a fraction of the depth actually reached.
   *
   * Completing on an absolute angle is brittle: smoothing attenuates the peak of
   * a fast rep, so the signal can miss a fixed threshold by a degree and merge
   * every rep in the set into one. Measuring the rebound relative to the
   * observed bottom removes the dependence on how completely the user locks out
   * and on how much the filter flattened the peak.
   */
  reboundFraction: number;
  /** Minimum gap kept between the completion and descent thresholds. */
  minHysteresisDeg: number;

  /**
   * How far the torso must actually travel during a rep, as a fraction of the
   * calibrated torso length.
   *
   * An elbow angle can oscillate from pose noise alone while the person sits
   * perfectly still, which produced reps out of nothing. In a real pushup the
   * body demonstrably moves through space, so requiring measured displacement
   * rejects a stationary body no matter what the joint angles appear to do.
   */
  minBodyTravelFraction: number;

  /**
   * The body must travel at least this many times as far as the hands.
   *
   * In a pushup the hands are planted and the torso travels toward them. Seated
   * arm movement is the reverse: hands move, body stays. This ratio separates
   * the two without needing to know the camera angle.
   */
  minBodyToHandTravelRatio: number;
};

export const DEFAULT_CONFIG: DetectorConfig = {
  upAngle: 150,
  downAngle: 95,
  dipAngle: 110,
  // Measured head-on at 1-2m, every joint sat around 0.31 mean and cleared 0.30
  // only about half the time, so a 0.30 gate discarded half the descent.
  minConfidence: 0.25,
  // Short: the median stage already removes outliers, and every millisecond here
  // is lag that attenuates a fast rep.
  smoothingTauMs: 25,
  maxElbowRateDegPerSec: 1500,
  // The timing guards were originally tight because they were the only defence
  // against stray movement being counted. The posture gate now does that job
  // properly, so these can be loose enough to accept a genuinely slow, controlled
  // rep instead of rejecting it.
  // Zero. The hysteresis band between dip and up already rejects jitter, and the
  // median prefilter removes outliers. Any dwell requirement instead demands the
  // arm linger above the return threshold, which at speed it does for only a
  // single frame — so the next descent was never registered and reps merged into
  // one. Measured: reps returning to 155 counted, 150 collapsed to 1 in 8.
  minTopDwellMs: 0,
  // 200 rather than 300: measured, a 2.5 rep/second set crosses the completion
  // thresholds only ~250ms apart when the user locks out well, so 300 rejected
  // genuine fast reps. 200 counts 8 of 8 at every tempo down to 300ms/rep.
  minRepMs: 200,
  maxRepMs: 12000,
  trackingLostFrames: 10,
  trackingLostFramesInRep: 30,
  calibrationMs: 1500,
  calibrationMinSamples: 12,
  rangeMinTravelDeg: 25,
  rangeReturnDeg: 15,
  rangeTimeoutMs: 20000,
  // Generous: a real rep rotates the torso somewhat, and a head-on view makes
  // the measured direction noisy because the torso is heavily foreshortened.
  torsoToleranceDeg: 40,
  minScaleRatio: 0.6,
  maxScaleRatio: 1.7,
  minBodyLineAngle: 130,
  hipSagAngle: 155,
  postureLostFrames: 5,
  countShallowReps: true,
  // Deliberately lenient. Half the demonstrated travel is unmistakably a rep
  // attempt rather than a twitch, and anything at 70% is treated as full depth
  // rather than demanding the very bottom, which is where tracking is worst.
  minTravelFraction: 0.45,
  fullDepthFraction: 0.7,
  topReturnFraction: 0.3,
  reboundFraction: 0.62,
  minHysteresisDeg: 8,
  // 0.15, not 0.25. A shallow rep genuinely moves the body less, and the origin
  // is only fixed once the smoothed angle leaves lockout, which lags the real
  // descent — measured, a shallow rep registered 0.036 against a 0.0375 bar and
  // was rejected. The body-versus-hands ratio below is the stronger test for a
  // motionless person anyway, since sitting still jitters both equally.
  minBodyTravelFraction: 0.15,
  minBodyToHandTravelRatio: 1.5,
};
