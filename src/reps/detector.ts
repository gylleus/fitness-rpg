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

export type DetectorState = {
  phase: Phase;
  /** Reps that reached full depth. */
  reps: number;
  /** Descents that turned back early. */
  partials: number;
  /** Smoothed elbow angle, or NaN when there is no usable reading. */
  elbowAngle: number;
  side: Side | null;
  tracking: boolean;
};

export type RepDetector = {
  push(frame: PoseFrame): DetectorEvent[];
  state(): Readonly<DetectorState>;
  reset(): void;
};

export function createRepDetector(config: Partial<DetectorConfig> = {}): RepDetector {
  const cfg: DetectorConfig = { ...DEFAULT_CONFIG, ...config };

  let phase: Phase = 'unknown';
  let reps = 0;
  let partials = 0;
  let smoothed = NaN;
  let side: Side | null = null;
  let tracking = false;
  let lowConfidenceFrames = 0;

  // A rep is timed from where the descent actually begins — the moment the angle
  // leaves lockout — not from where it crosses into the dip band. The dip band is
  // only the middle slice of the movement, so timing it instead would under-measure
  // every rep and reject legitimately fast ones.
  let descentStartedAt = NaN;
  let dipMinAngle = Infinity;
  // When the top was reached, so a new descent can be required to wait.
  let topEnteredAt = 0;

  function reset(): void {
    phase = 'unknown';
    smoothed = NaN;
    dipMinAngle = Infinity;
    descentStartedAt = NaN;
    topEnteredAt = 0;
  }

  /**
   * Pick the arm the model can actually see. In a side-on pushup the far arm is
   * occluded by the torso, so scoring both and taking the better one avoids
   * counting off a limb the model is only guessing at.
   */
  function selectSide(frame: PoseFrame): { side: Side; confidence: number } | null {
    let best: { side: Side; confidence: number } | null = null;
    for (const candidate of ['left', 'right'] as Side[]) {
      const j = SIDE_JOINTS[candidate];
      const kp = frame.keypoints;
      const shoulder = kp[j.shoulder];
      const elbow = kp[j.elbow];
      const wrist = kp[j.wrist];
      if (!shoulder || !elbow || !wrist) continue;
      // The weakest joint governs: one unreliable point invalidates the angle,
      // so a high average must not paper over a missing wrist.
      const confidence = Math.min(shoulder.score, elbow.score, wrist.score);
      if (!best || confidence > best.confidence) best = { side: candidate, confidence };
    }
    return best;
  }

  function push(frame: PoseFrame): DetectorEvent[] {
    const events: DetectorEvent[] = [];

    const selected = selectSide(frame);
    const usable = selected !== null && selected.confidence >= cfg.minConfidence;

    let angle = NaN;
    if (usable) {
      const j = SIDE_JOINTS[selected.side];
      angle = angleDeg(
        frame.keypoints[j.shoulder],
        frame.keypoints[j.elbow],
        frame.keypoints[j.wrist],
      );
    }

    if (!usable || Number.isNaN(angle)) {
      lowConfidenceFrames++;
      if (tracking && lowConfidenceFrames >= cfg.trackingLostFrames) {
        tracking = false;
        // Reset rather than resume: coming back mid-descent and then rising would
        // otherwise emit a rep for a movement that was never actually observed.
        reset();
        events.push({ type: 'trackingLost', t: frame.t });
      }
      return events;
    }

    lowConfidenceFrames = 0;
    side = selected.side;
    if (!tracking) {
      tracking = true;
      events.push({ type: 'trackingRegained', t: frame.t });
    }

    smoothed = ema(smoothed, angle, cfg.emaAlpha);

    switch (phase) {
      case 'unknown':
        // Only start counting from a known top, so a session that begins
        // mid-pushup does not award a rep for half a movement.
        if (smoothed >= cfg.upAngle) {
          phase = 'top';
          topEnteredAt = frame.t;
        }
        break;

      case 'top':
        if (smoothed >= cfg.upAngle) {
          // Still locked out; any earlier dip below lockout was a wobble, not a descent.
          descentStartedAt = NaN;
        } else if (Number.isNaN(descentStartedAt)) {
          descentStartedAt = frame.t;
        }
        if (smoothed < cfg.dipAngle && frame.t - topEnteredAt >= cfg.minTopDwellMs) {
          phase = 'dip';
          dipMinAngle = smoothed;
        }
        break;

      case 'dip': {
        dipMinAngle = Math.min(dipMinAngle, smoothed);
        if (smoothed < cfg.upAngle) break;

        const startedAt = Number.isNaN(descentStartedAt) ? frame.t : descentStartedAt;
        const durationMs = frame.t - startedAt;
        phase = 'top';
        topEnteredAt = frame.t;
        descentStartedAt = NaN;

        if (durationMs < cfg.minRepMs) {
          events.push({ type: 'rejected', reason: 'tooFast', durationMs, t: frame.t });
          break;
        }
        if (durationMs > cfg.maxRepMs) {
          events.push({ type: 'rejected', reason: 'tooSlow', durationMs, t: frame.t });
          break;
        }

        const valid = dipMinAngle <= cfg.downAngle;
        if (valid) reps++;
        else partials++;

        events.push({
          type: 'rep',
          index: valid ? reps : partials,
          valid,
          minAngle: dipMinAngle,
          durationMs,
          startedAt,
          endedAt: frame.t,
        });
        break;
      }
    }

    return events;
  }

  return {
    push,
    state: () => ({ phase, reps, partials, elbowAngle: smoothed, side, tracking }),
    reset() {
      reset();
      reps = 0;
      partials = 0;
      side = null;
      tracking = false;
      lowConfidenceFrames = 0;
    },
  };
}
