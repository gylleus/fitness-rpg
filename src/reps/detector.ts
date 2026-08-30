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
import { DEFAULT_CONFIG, type DetectorConfig } from './config';
import { SIDE_JOINTS, type PoseFrame, type Side } from '../pose/keypoints';

export type RepEvent = {
  type: 'rep';
  /** 1-based index of this rep within the set. */
  index: number;
  /**
   * False when the descent never reached `downAngle`. Partial reps are reported
   * rather than dropped so the UI can tell the user *why* it did not count.
   */
  valid: boolean;
  /** Deepest (smallest) elbow angle reached during the descent. */
  minAngle: number;
  durationMs: number;
  startedAt: number;
  endedAt: number;
};

export type TrackingEvent = { type: 'trackingLost' | 'trackingRegained'; t: number };

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
}

/**
 * Picks the arm the model can actually see.
 *
 * In a side-on pushup the far arm is occluded by the torso, so scoring both and
 * taking the better one avoids counting off a limb the model is only guessing at.
 * The weakest joint governs: one unreliable point invalidates the whole angle, so
 * a good average must not paper over a missing wrist.
 */
function selectSide(frame: PoseFrame): { side: Side; confidence: number } | null {
  'worklet';
  let bestSide: Side | null = null;
  let bestConfidence = -1;
  const sides: Side[] = ['left', 'right'];
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

  let angle = NaN;
  if (usable && selected !== null) {
    const j = SIDE_JOINTS[selected.side];
    angle = angleDeg(
      frame.keypoints[j.shoulder],
      frame.keypoints[j.elbow],
      frame.keypoints[j.wrist],
    );
  }

  if (!usable || Number.isNaN(angle)) {
    s.lowConfidenceFrames++;
    if (s.tracking && s.lowConfidenceFrames >= cfg.trackingLostFrames) {
      s.tracking = false;
      // Reset rather than resume: reacquiring mid-descent and then rising would
      // otherwise emit a rep for a movement that was never actually observed.
      resetMovement(s);
      events.push({ type: 'trackingLost', t: frame.t });
    }
    return events;
  }

  s.lowConfidenceFrames = 0;
  if (selected !== null) s.side = selected.side;
  if (!s.tracking) {
    s.tracking = true;
    events.push({ type: 'trackingRegained', t: frame.t });
  }

  s.elbowAngle = ema(s.elbowAngle, angle, cfg.emaAlpha);
  const smoothed = s.elbowAngle;

  if (s.phase === 'unknown') {
    // Only start counting from a known top, so a session that begins mid-pushup
    // does not award a rep for half a movement.
    if (smoothed >= cfg.upAngle) {
      s.phase = 'top';
      s.topEnteredAt = frame.t;
    }
    return events;
  }

  if (s.phase === 'top') {
    if (smoothed >= cfg.upAngle) {
      // Still locked out; any earlier dip below lockout was a wobble.
      s.descentStartedAt = NaN;
    } else if (Number.isNaN(s.descentStartedAt)) {
      s.descentStartedAt = frame.t;
    }
    if (smoothed < cfg.dipAngle && frame.t - s.topEnteredAt >= cfg.minTopDwellMs) {
      s.phase = 'dip';
      s.dipMinAngle = smoothed;
    }
    return events;
  }

  // phase === 'dip'
  if (smoothed < s.dipMinAngle) s.dipMinAngle = smoothed;
  if (smoothed < cfg.upAngle) return events;

  const startedAt = Number.isNaN(s.descentStartedAt) ? frame.t : s.descentStartedAt;
  const durationMs = frame.t - startedAt;
  s.phase = 'top';
  s.topEnteredAt = frame.t;
  s.descentStartedAt = NaN;

  if (durationMs < cfg.minRepMs) {
    events.push({ type: 'rejected', reason: 'tooFast', durationMs, t: frame.t });
    return events;
  }
  if (durationMs > cfg.maxRepMs) {
    events.push({ type: 'rejected', reason: 'tooSlow', durationMs, t: frame.t });
    return events;
  }

  const valid = s.dipMinAngle <= cfg.downAngle;
  if (valid) s.reps++;
  else s.partials++;

  events.push({
    type: 'rep',
    index: valid ? s.reps : s.partials,
    valid,
    minAngle: s.dipMinAngle,
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
