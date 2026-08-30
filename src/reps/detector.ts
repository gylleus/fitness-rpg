/**
 * Pushup rep detector.
 *
 * A pure function over a stream of pose frames: no React, no camera, no native
 * modules. It runs identically inside a VisionCamera worklet and inside a Node test
 * process, which is what lets thresholds be tuned offline against recorded fixtures
 * instead of by doing pushups after every edit.
 *
 * The signal is the elbow angle (shoulder→elbow→wrist). An angle is invariant to how
 * far the phone is from the user, how big they are, and what height the camera sits
 * at — none of which is true of raw keypoint positions.
 *
 * The machine has three states:
 *
 *   UNKNOWN ──(angle ≥ upAngle)──▶ TOP ──(angle < dipAngle)──▶ DIP
 *                                   ▲                            │
 *                                   └────(angle ≥ upAngle)───────┘
 *                                              emits a rep
 *
 * The gap between `dipAngle` (descent starts) and `upAngle` (lockout) is the
 * hysteresis band. A single threshold would emit several reps per rep as the
 * smoothed angle jittered across it.
 */

import { angleDeg, ema } from './geometry';
import { angleDifference, measureBody, median } from './body';
import { DEFAULT_CONFIG, type DetectorConfig } from './config';
import { SIDE_JOINTS, type PoseFrame, type Side } from '../pose/keypoints';

export type RepEvent = {
  type: 'rep';
  /**
   * 1-based ordinal of this movement within the set, counting valid and partial
   * reps in a single sequence so no two events share an index.
   */
  index: number;
  /**
   * False when the descent never reached `downAngle`. Partial reps are reported
   * rather than dropped so the UI can tell the user *why* it did not count.
   */
  valid: boolean;
  /** Deepest (smallest) elbow angle reached during the descent. */
  minAngle: number;
  /** Form problems observed during this rep. */
  flags: string[];
  durationMs: number;
  startedAt: number;
  endedAt: number;
};

export type TrackingEvent = {
  type:
    | 'trackingLost'
    | 'trackingRegained'
    | 'positionAcquired'
    | 'positionLost'
    | 'calibrated';
  t: number;
};

/** A movement that looked like a rep but failed a plausibility guard. */
export type RejectedEvent = {
  type: 'rejected';
  reason: 'tooFast' | 'tooSlow';
  durationMs: number;
  t: number;
};

export type DetectorEvent = RepEvent | TrackingEvent | RejectedEvent;

export type Phase = 'unknown' | 'top' | 'dip';

export type RepDetector = {
  push(frame: PoseFrame): DetectorEvent[];
  state(): Readonly<DetectorState>;
  reset(): void;
};

/**
 * All mutable detector state, held explicitly rather than in closures.
 *
 * This shape exists so the state machine can run inside a camera worklet: a
 * closure created on the JS thread cannot be called from the camera thread, and
 * shipping keypoints to JS at 30fps to avoid that is exactly the bridge traffic
 * the pipeline is designed to prevent.
 */
export type DetectorState = {
  phase: Phase;
  reps: number;
  partials: number;
  /** Smoothed elbow angle, or NaN when there is no usable reading. */
  elbowAngle: number;
  side: Side | null;
  tracking: boolean;
  lowConfidenceFrames: number;
  descentStartedAt: number;
  dipMinAngle: number;
  topEnteredAt: number;
  /** Whether the body currently looks like a pushup position. */
  inPosition: boolean;
  outOfPositionFrames: number;
  torsoTilt: number;
  bodyLine: number;
  /** Hip sag seen at any point during the rep in progress. */
  sagThisRep: boolean;
  /** Confidence of the joints the posture gate depends on, for diagnostics. */
  shoulderScore: number;
  hipScore: number;
  kneeScore: number;

  /** Until a reference is captured, nothing is counted. */
  mode: 'calibrating' | 'counting';
  calibration: Calibration | null;
  /** Samples gathered while the user holds the top position. */
  calTorsoDir: number[];
  calTorsoLength: number[];
  calElbow: number[];
  calStartedAt: number;
  /** How far through calibration we are, 0..1, for the UI. */
  calProgress: number;
  /** How far the torso has drifted from the reference. */
  torsoDelta: number;
  scaleRatio: number;
};

export function createDetectorState(): DetectorState {
  'worklet';
  return {
    phase: 'unknown',
    reps: 0,
    partials: 0,
    elbowAngle: NaN,
    side: null,
    tracking: false,
    lowConfidenceFrames: 0,
    descentStartedAt: NaN,
    dipMinAngle: Infinity,
    topEnteredAt: 0,
    inPosition: false,
    outOfPositionFrames: 0,
    torsoTilt: NaN,
    bodyLine: NaN,
    sagThisRep: false,
    shoulderScore: 0,
    hipScore: 0,
    kneeScore: 0,
    mode: 'calibrating',
    calibration: null,
    calTorsoDir: [],
    calTorsoLength: [],
    calElbow: [],
    calStartedAt: NaN,
    calProgress: 0,
    torsoDelta: NaN,
    scaleRatio: NaN,
  };
}

/** Clears movement state but keeps the rep tally and tracking status. */
function resetMovement(s: DetectorState): void {
  'worklet';
  s.phase = 'unknown';
  s.elbowAngle = NaN;
  s.dipMinAngle = Infinity;
  s.descentStartedAt = NaN;
  s.topEnteredAt = 0;
  s.sagThisRep = false;
}

/**
 * Picks the arm the model can actually see.
 *
 * In a side-on pushup the far arm is occluded by the torso, so scoring both and
 * taking the better one avoids counting off a limb the model is only guessing at.
 * The weakest joint governs: one unreliable point invalidates the whole angle, so
 * a good average must not paper over a missing wrist.
 */
const SIDES: Side[] = ['left', 'right'];

/**
 * How much better the other arm must score before we switch to it.
 *
 * Without this margin the selection flaps frame to frame on a partly-frontal
 * view, and since both sides share one EMA the smoothed angle ends up blending
 * two different elbows — an angle belonging to neither arm.
 */
const SIDE_SWITCH_MARGIN = 0.15;

function scoreSide(frame: PoseFrame, candidate: Side): number {
  'worklet';
  const j = SIDE_JOINTS[candidate];
  const shoulder = frame.keypoints[j.shoulder];
  const elbow = frame.keypoints[j.elbow];
  const wrist = frame.keypoints[j.wrist];
  if (shoulder == null || elbow == null || wrist == null) return -1;
  // The weakest joint governs: one unreliable point invalidates the whole angle,
  // so a good average must not paper over a missing wrist.
  return Math.min(shoulder.score, elbow.score, wrist.score);
}

function selectSide(frame: PoseFrame): { side: Side; confidence: number } | null {
  'worklet';
  let bestSide: Side | null = null;
  let bestConfidence = -1;
  const sides = SIDES;
  for (let i = 0; i < sides.length; i++) {
    const candidate = sides[i];
    const j = SIDE_JOINTS[candidate];
    const shoulder = frame.keypoints[j.shoulder];
    const elbow = frame.keypoints[j.elbow];
    const wrist = frame.keypoints[j.wrist];
    if (shoulder == null || elbow == null || wrist == null) continue;
    const confidence = Math.min(shoulder.score, elbow.score, wrist.score);
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestSide = candidate;
    }
  }
  return bestSide == null ? null : { side: bestSide, confidence: bestConfidence };
}

export type Calibration = {
  /** Torso direction captured while holding the top position. */
  torsoDir: number;
  /** Torso length at the top, used as the body scale reference. */
  torsoLength: number;
  /** Elbow angle at full extension, for this person in this camera view. */
  topElbowAngle: number;
};

export type Posture = {
  /** True when the body matches the calibrated reference. */
  inPosition: boolean;
  /** How far the torso has rotated from the reference, degrees. */
  torsoDelta: number;
  /** Torso length relative to the reference. 1 means unchanged. */
  scaleRatio: number;
  /** Shoulder→hip→knee angle. NaN when the knee is not visible. */
  bodyLine: number;
  /** In position, but the hips are sagging. */
  hipSag: boolean;
};

/**
 * Decides whether the body still matches the position it was calibrated in.
 *
 * Nothing here is compared against an absolute expectation. Standing up rotates
 * the torso well away from the reference and changes its apparent length, which
 * is what excludes arm movement performed out of position — without ever needing
 * to know which way is up in the image.
 */
function evaluatePosture(
  frame: PoseFrame,
  side: Side,
  cal: Calibration,
  cfg: DetectorConfig,
): Posture {
  'worklet';
  const body = measureBody(frame, cfg.minConfidence);
  if (!body.ok) {
    return { inPosition: false, torsoDelta: NaN, scaleRatio: NaN, bodyLine: NaN, hipSag: false };
  }

  const torsoDelta = angleDifference(body.torsoDir, cal.torsoDir);
  const scaleRatio = cal.torsoLength > 0 ? body.torsoLength / cal.torsoLength : NaN;

  if (torsoDelta > cfg.torsoToleranceDeg) {
    return { inPosition: false, torsoDelta, scaleRatio, bodyLine: NaN, hipSag: false };
  }
  if (
    !Number.isFinite(scaleRatio) ||
    scaleRatio < cfg.minScaleRatio ||
    scaleRatio > cfg.maxScaleRatio
  ) {
    return { inPosition: false, torsoDelta, scaleRatio, bodyLine: NaN, hipSag: false };
  }

  // Straightness is a form check, not a position check, and is only measurable
  // when the knee is actually visible — a head-on view often crops or occludes it.
  const j = SIDE_JOINTS[side];
  const shoulder = frame.keypoints[j.shoulder];
  const hip = frame.keypoints[j.hip];
  const knee = frame.keypoints[j.knee];
  let bodyLine = NaN;
  if (
    shoulder != null &&
    hip != null &&
    knee != null &&
    shoulder.score >= cfg.minConfidence &&
    hip.score >= cfg.minConfidence &&
    knee.score >= cfg.minConfidence
  ) {
    bodyLine = angleDeg(shoulder, hip, knee);
  }

  if (!Number.isNaN(bodyLine) && bodyLine < cfg.minBodyLineAngle) {
    // Folded at the hips. The shoulder→hip axis can be unchanged while the body
    // is not remotely in a plank, so this is a position check and not just a
    // form flag — but only when the knee is actually visible to measure it.
    return { inPosition: false, torsoDelta, scaleRatio, bodyLine, hipSag: false };
  }

  const hipSag = !Number.isNaN(bodyLine) && bodyLine < cfg.hipSagAngle;
  return { inPosition: true, torsoDelta, scaleRatio, bodyLine, hipSag };
}

/**
 * Elbow-angle thresholds for this person in this camera view.
 *
 * A head-on camera foreshortens the arm, so the projected elbow angle at full
 * lockout may read 150 degrees rather than 180. Fixed absolute thresholds would
 * then never be reached. Deriving them from the observed top makes the same
 * relative range of motion work from any viewpoint.
 */
function thresholdsFor(cal: Calibration) {
  'worklet';
  const top = cal.topElbowAngle;
  // Spreads chosen so an unforeshortened view (top ≈ 170) lands close to the
  // hand-tuned absolute thresholds these replaced: 158 / 130 / 100.
  return {
    up: top - 12,
    dip: top - 40,
    down: top - 70,
  };
}

/**
 * Advances the state machine by one frame, mutating `s` and returning any events.
 *
 * Worklet-safe: no closures, no imports beyond pure maths.
 */
export function stepDetector(
  s: DetectorState,
  frame: PoseFrame,
  cfg: DetectorConfig,
): DetectorEvent[] {
  'worklet';
  const events: DetectorEvent[] = [];

  const selected = selectSide(frame);
  const usable = selected !== null && selected.confidence >= cfg.minConfidence;

  if (!usable) {
    s.lowConfidenceFrames++;
    if (s.tracking && s.lowConfidenceFrames >= cfg.trackingLostFrames) {
      s.tracking = false;
      // Reset rather than resume: reacquiring mid-descent and then rising would
      // otherwise emit a rep for a movement that was never actually observed.
      resetMovement(s);
      if (s.mode === 'calibrating') {
        // Discard a partial hold too, so the reference is never averaged across
        // the position before the dropout and the one after it.
        s.calTorsoDir = [];
        s.calTorsoLength = [];
        s.calElbow = [];
        s.calStartedAt = NaN;
        s.calProgress = 0;
      }
      events.push({ type: 'trackingLost', t: frame.t });
    }
    return events;
  }

  s.lowConfidenceFrames = 0;

  // Stick with the arm already being tracked unless the other one is clearly
  // better, and restart the EMA when the side genuinely changes so the average
  // never blends two different elbows.
  if (selected !== null) {
    const chosen = selected.side;
    if (s.side === null) {
      s.side = chosen;
    } else if (chosen !== s.side) {
      const currentScore = scoreSide(frame, s.side);
      if (currentScore < cfg.minConfidence || selected.confidence > currentScore + SIDE_SWITCH_MARGIN) {
        s.side = chosen;
        s.elbowAngle = NaN;
      }
    }
  }

  if (!s.tracking) {
    s.tracking = true;
    events.push({ type: 'trackingRegained', t: frame.t });
  }

  const active = s.side ?? (selected as { side: Side }).side;
  const joints = SIDE_JOINTS[active];
  const angle = angleDeg(
    frame.keypoints[joints.shoulder],
    frame.keypoints[joints.elbow],
    frame.keypoints[joints.wrist],
  );
  if (Number.isNaN(angle)) {
    s.lowConfidenceFrames++;
    return events;
  }

  const pj = SIDE_JOINTS[active];
  s.shoulderScore = frame.keypoints[pj.shoulder]?.score ?? 0;
  s.hipScore = frame.keypoints[pj.hip]?.score ?? 0;
  s.kneeScore = frame.keypoints[pj.knee]?.score ?? 0;

  // --- Calibration -------------------------------------------------------
  // Until the user's own position is captured there is nothing to compare
  // against, so nothing is counted.
  if (s.mode === 'calibrating') {
    const body = measureBody(frame, cfg.minConfidence);
    if (!body.ok) {
      // Lost the body mid-hold: start the hold over rather than averaging a
      // reference across two different positions.
      s.calTorsoDir = [];
      s.calTorsoLength = [];
      s.calElbow = [];
      s.calStartedAt = NaN;
      s.calProgress = 0;
      return events;
    }

    if (Number.isNaN(s.calStartedAt)) s.calStartedAt = frame.t;
    s.calTorsoDir.push(body.torsoDir);
    s.calTorsoLength.push(body.torsoLength);
    s.calElbow.push(angle);

    const elapsed = frame.t - s.calStartedAt;
    s.calProgress = Math.min(1, elapsed / cfg.calibrationMs);

    if (elapsed >= cfg.calibrationMs && s.calTorsoDir.length >= cfg.calibrationMinSamples) {
      // Medians rather than means: a couple of bad frames during the hold
      // should not drag the reference with them.
      s.calibration = {
        torsoDir: median(s.calTorsoDir),
        torsoLength: median(s.calTorsoLength),
        topElbowAngle: median(s.calElbow),
      };
      s.calTorsoDir = [];
      s.calTorsoLength = [];
      s.calElbow = [];
      s.mode = 'counting';
      s.inPosition = true;
      s.calProgress = 1;
      events.push({ type: 'calibrated', t: frame.t });
    }
    return events;
  }

  const cal = s.calibration;
  if (cal == null) return events;

  // --- Posture gate ------------------------------------------------------
  // Everything is relative to the captured reference, so this works from any
  // camera placement and any buffer orientation.
  const posture = evaluatePosture(frame, active, cal, cfg);
  s.torsoDelta = posture.torsoDelta;
  s.scaleRatio = posture.scaleRatio;
  s.bodyLine = posture.bodyLine;

  if (posture.inPosition) {
    s.outOfPositionFrames = 0;
    if (!s.inPosition) {
      s.inPosition = true;
      events.push({ type: 'positionAcquired', t: frame.t });
    }
    if (posture.hipSag) s.sagThisRep = true;
  } else {
    s.outOfPositionFrames++;
    if (s.inPosition && s.outOfPositionFrames >= cfg.postureLostFrames) {
      s.inPosition = false;
      // Abandon the movement in progress rather than resuming it later: the part
      // that happened out of position was not a pushup.
      resetMovement(s);
      events.push({ type: 'positionLost', t: frame.t });
    }
  }

  if (!s.inPosition) return events;

  const th = thresholdsFor(cal);

  s.elbowAngle = ema(s.elbowAngle, angle, cfg.emaAlpha);
  const smoothed = s.elbowAngle;

  if (s.phase === 'unknown') {
    // Only start counting from a known top, so a session that begins mid-pushup
    // does not award a rep for half a movement.
    if (smoothed >= th.up) {
      s.phase = 'top';
      s.topEnteredAt = frame.t;
    }
    return events;
  }

  if (s.phase === 'top') {
    if (smoothed >= th.up) {
      // Still locked out; any earlier dip below lockout was a wobble.
      s.descentStartedAt = NaN;
    } else if (Number.isNaN(s.descentStartedAt)) {
      s.descentStartedAt = frame.t;
      s.dipMinAngle = smoothed;
    }
    // Track depth from the moment the descent begins. Waiting until the dip
    // transition discards the deepest part of a fast rep taken off a short
    // lockout, scoring a full-depth rep as a partial.
    if (!Number.isNaN(s.descentStartedAt) && smoothed < s.dipMinAngle) {
      s.dipMinAngle = smoothed;
    }
    if (smoothed < th.dip && frame.t - s.topEnteredAt >= cfg.minTopDwellMs) {
      s.phase = 'dip';
    }
    return events;
  }

  // phase === 'dip'
  if (smoothed < s.dipMinAngle) s.dipMinAngle = smoothed;
  if (smoothed < th.up) return events;

  const startedAt = Number.isNaN(s.descentStartedAt) ? frame.t : s.descentStartedAt;
  const durationMs = frame.t - startedAt;
  s.phase = 'top';
  s.topEnteredAt = frame.t;
  s.descentStartedAt = NaN;

  if (durationMs < cfg.minRepMs) {
    s.dipMinAngle = Infinity;
    events.push({ type: 'rejected', reason: 'tooFast', durationMs, t: frame.t });
    return events;
  }
  if (durationMs > cfg.maxRepMs) {
    s.dipMinAngle = Infinity;
    events.push({ type: 'rejected', reason: 'tooSlow', durationMs, t: frame.t });
    return events;
  }

  const depth = s.dipMinAngle;
  const sagged = s.sagThisRep;
  s.dipMinAngle = Infinity;
  s.sagThisRep = false;

  const valid = depth <= th.down;
  if (valid) s.reps++;
  else s.partials++;

  events.push({
    type: 'rep',
    // #9: a single monotonic ordinal across valid and partial reps, so two
    // events never share an index.
    index: s.reps + s.partials,
    valid,
    minAngle: depth,
    flags: sagged ? ['hipSag'] : [],
    durationMs,
    startedAt,
    endedAt: frame.t,
  });
  return events;
}

/**
 * Stateful wrapper around {@link stepDetector} for use on the JS thread and in
 * tests. The camera path uses the reducer directly.
 */
export function createRepDetector(config: Partial<DetectorConfig> = {}): RepDetector {
  const cfg: DetectorConfig = { ...DEFAULT_CONFIG, ...config };
  let s = createDetectorState();

  return {
    push: (frame: PoseFrame) => stepDetector(s, frame, cfg),
    state: () => s,
    reset: () => {
      s = createDetectorState();
    },
  };
}
