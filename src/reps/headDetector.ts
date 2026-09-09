/**
 * Self-calibrating pushup rep detector driven by upper-body displacement.
 *
 * The elbow-angle approach measured the arm — three keypoints including the
 * wrist, which is the least reliable joint in a head-on view. Noise in any one
 * joint swings the derived angle by tens of degrees, and the guards stacked on
 * top of it to compensate grew into their own source of failure.
 *
 * This detector reads one signal instead: how far the upper body has moved from
 * the position it holds at the top of a pushup, in units of shoulder width. A
 * pushup moves the torso through an excursion an order of magnitude larger than
 * keypoint jitter, and displacement *is* movement — a motionless body cannot
 * produce phantom reps out of angle noise.
 *
 * ## Which points are tracked, and why per-source references
 *
 * The shoulders. The face was tried first ("nose and eyes are MoveNet's most
 * reliable keypoints") and failed in the field: in a plank you look at the
 * floor, so the camera sees the top of the skull and the face keypoints jump
 * half the frame. Shoulders genuinely face the camera and scored 0.7-0.97 in
 * the same frames.
 *
 * Averaging the two shoulders into one midpoint was tried next and also failed
 * in the field: whichever shoulder is weaker flickers across the confidence
 * gate, and each flicker snaps the "midpoint" between mid-chest and one
 * shoulder — a half-shoulder-width teleport. So each source — left shoulder,
 * right shoulder, and the face as a last resort — is compared against ITS OWN
 * reference. All sources ride the same torso, so each displacement estimates
 * the same physical motion, and sources dropping in and out merely changes
 * which estimates are averaged — the value itself stays continuous.
 *
 * ## Self-calibration
 *
 * There is no calibration ceremony. The reference is captured silently the
 * first time the tracked sources hold still for `calibrationMs` — which is
 * what settling into a plank looks like — and re-captured the same way
 * whenever the position is lost (the phone was nudged, the user moved). An
 * explicit hold step and a demonstration rep were tried first and were the
 * dominant failure mode in practice: three sessions in a row died inside the
 * ceremony before a single rep could be counted.
 *
 * Rep depth starts at `defaultDepthD` and adapts to the median of the depths
 * actually performed, so thresholds tune themselves to the camera geometry
 * within a rep or two instead of depending on a one-shot demonstration that a
 * single noise excursion could poison.
 *
 *   (still for calibrationMs) ──▶ counting:
 *      TOP ──(d ≥ dipFraction·D)──▶ DIP ──(rebound or full return)──▶ rep
 *
 * where D is the current depth estimate and d the normalised displacement.
 * Same worklet constraints as detector.ts: explicit state, no closures,
 * callees defined above callers.
 */

import { distance } from './geometry';
import { measureBody, median } from './body';
import { KEYPOINT, type PoseFrame } from '../pose/keypoints';

export type HeadRepEvent = {
  type: 'rep';
  /** 1-based ordinal counting valid and shallow reps alike. */
  index: number;
  /** False when the descent never reached `fullDepthFraction` of the depth estimate. */
  valid: boolean;
  /** Deepest displacement this rep, as a fraction of the depth estimate. */
  depth: number;
  durationMs: number;
  startedAt: number;
  endedAt: number;
};

export type HeadTrackingEvent = {
  type:
    | 'trackingLost'
    | 'trackingRegained'
    | 'positionAcquired'
    | 'positionLost'
    | 'calibrated';
  t: number;
};

export type HeadRejectedEvent = {
  type: 'rejected';
  reason: 'tooFast' | 'tooSlow' | 'wanderedOff';
  durationMs: number;
  t: number;
};

export type HeadDetectorEvent = HeadRepEvent | HeadTrackingEvent | HeadRejectedEvent;

export type HeadPhase = 'unknown' | 'top' | 'dip';

/** Tracked sources: left shoulder, right shoulder, face midpoint. */
export const SOURCE_COUNT = 3;

export type HeadDetectorConfig = {
  /** Sources scoring below this are ignored for the frame. */
  minHeadConfidence: number;
  /** Confidence gate for the shoulders/hips used to measure body scale. */
  minScaleConfidence: number;
  /** EMA time constant for each source position, ms. */
  smoothingTauMs: number;
  /** How long the sources must hold still to capture a reference. */
  calibrationMs: number;
  calibrationMinSamples: number;
  /**
   * How far a source may roam during the stillness hold, as a fraction of body
   * scale, before the hold restarts. This is what distinguishes settling into
   * position from doing reps: reps never hold still this long.
   */
  calibrationStillnessFraction: number;
  /** Initial rep depth estimate, in body-scale units, before any rep is seen. */
  defaultDepthD: number;
  /** Bounds the adaptive depth estimate so outliers cannot poison thresholds. */
  minDepthD: number;
  maxDepthD: number;
  /** How many recent rep depths the estimate is the median of. */
  depthWindow: number;
  /** Fraction of the depth estimate that starts a descent. */
  dipFraction: number;
  /** Fraction of the depth estimate the return must come back under. */
  completeFraction: number;
  /**
   * Fraction of the depth actually reached that must be undone for the rep to
   * complete. A fast set never returns to a full top between reps — demanding
   * the absolute `completeFraction` there merges the whole set into one rep.
   * Whichever of the two completions is easier applies.
   */
  reboundFraction: number;
  /**
   * Minimum gap kept between the completion and dip thresholds, as a fraction
   * of the depth estimate, so rebound completion can never sit so close to the
   * dip threshold that jitter re-triggers a descent.
   */
  minHysteresisFraction: number;
  /** Fraction of the depth estimate that counts as a full rep. */
  fullDepthFraction: number;
  /**
   * Displacement beyond this multiple of the depth estimate means the user
   * left the position entirely — stood up, walked off. Not a rep in progress.
   */
  wanderFraction: number;
  minRepMs: number;
  maxRepMs: number;
  /** Consecutive unusable frames before tracking is declared lost. */
  trackingLostFrames: number;
  /**
   * Time constant for re-anchoring each reference toward its source's current
   * position while resting at the top. Absorbs slow drift — shuffling the
   * knees, settling the shoulders — without following the fast motion of a rep.
   */
  refAdaptTauMs: number;
  /** Only adapt references when within this fraction of depth of the top. */
  refAdaptMaxFraction: number;
  /** Count shallow reps (recorded as such) rather than discarding them. */
  countShallowReps: boolean;
};

export const HEAD_DEFAULT_CONFIG: HeadDetectorConfig = {
  minHeadConfidence: 0.3,
  minScaleConfidence: 0.25,
  // 35, not 60: at the ~20fps this camera actually delivers, a 60ms EMA
  // visibly flattened fast reps.
  smoothingTauMs: 35,
  calibrationMs: 1200,
  calibrationMinSamples: 10,
  calibrationStillnessFraction: 0.25,
  // Real head-on reps measured 0.98 and 1.45 scale units on the test setup, so
  // 1.0 counts a first rep from any plausible geometry; the estimate then
  // adapts to what the user actually does.
  defaultDepthD: 1.0,
  minDepthD: 0.6,
  maxDepthD: 2.5,
  depthWindow: 5,
  dipFraction: 0.5,
  completeFraction: 0.32,
  reboundFraction: 0.55,
  // 0.05, not 0.12: simulated, a rebound at 38% of depth reads ~0.25·D after
  // smoothing lag, and a 0.12 floor capped completion just short of reachable,
  // so partial-lockout sets merged into one rep.
  minHysteresisFraction: 0.05,
  fullDepthFraction: 0.8,
  wanderFraction: 2.5,
  // 180, not 250: the descent clock starts when the torso leaves the top band,
  // and a genuinely fast rep spends barely 200ms outside it.
  minRepMs: 180,
  maxRepMs: 15000,
  trackingLostFrames: 15,
  refAdaptTauMs: 4000,
  refAdaptMaxFraction: 0.2,
  countShallowReps: true,
};

export type HeadDetectorState = {
  /** True once a reference has ever been captured; counting requires it. */
  calibrated: boolean;
  phase: HeadPhase;
  reps: number;
  partials: number;
  tracking: boolean;
  inPosition: boolean;
  lowConfidenceFrames: number;

  /** Smoothed position per source. NaN when the source is not usable. */
  srcX: number[];
  srcY: number[];
  /** Reference position per source. NaN when never captured. */
  refX: number[];
  refY: number[];
  /** Body scale captured with the reference — the yardstick for everything. */
  refScale: number;
  /** Best source confidence this frame, for diagnostics. */
  headScore: number;
  lastFrameT: number;

  /** Current rep depth estimate, in body-scale units. */
  depthD: number;
  /** Depths of recent counted reps, for the adaptive estimate. */
  repDepths: number[];
  /** Current displacement from the reference, in body-scale units. */
  d: number;

  calStartedAt: number;
  /** Per-source position samples gathered during the stillness hold. */
  calSX: number[][];
  calSY: number[][];
  calScale: number[];
  calProgress: number;
  /** Per-source bounding box during the hold, for the stillness check. */
  calMinX: number[];
  calMaxX: number[];
  calMinY: number[];
  calMaxY: number[];

  descentStartedAt: number;
  maxDThisRep: number;

  lastRepValid: boolean | null;
  lastRepDepth: number;
  lastRepDurationMs: number;
};

function nanArray(): number[] {
  'worklet';
  const a: number[] = [];
  for (let i = 0; i < SOURCE_COUNT; i++) a.push(NaN);
  return a;
}

function emptyPerSource(): number[][] {
  'worklet';
  const a: number[][] = [];
  for (let i = 0; i < SOURCE_COUNT; i++) a.push([]);
  return a;
}

export function createHeadDetectorState(): HeadDetectorState {
  'worklet';
  return {
    calibrated: false,
    phase: 'unknown',
    reps: 0,
    partials: 0,
    tracking: false,
    inPosition: false,
    lowConfidenceFrames: 0,
    srcX: nanArray(),
    srcY: nanArray(),
    refX: nanArray(),
    refY: nanArray(),
    refScale: NaN,
    headScore: 0,
    lastFrameT: NaN,
    depthD: NaN,
    repDepths: [],
    d: NaN,
    calStartedAt: NaN,
    calSX: emptyPerSource(),
    calSY: emptyPerSource(),
    calScale: [],
    calProgress: 0,
    calMinX: nanArray(),
    calMaxX: nanArray(),
    calMinY: nanArray(),
    calMaxY: nanArray(),
    descentStartedAt: NaN,
    maxDThisRep: 0,
    lastRepValid: null,
    lastRepDepth: NaN,
    lastRepDurationMs: NaN,
  };
}

function resetMovement(s: HeadDetectorState): void {
  'worklet';
  s.phase = 'unknown';
  s.descentStartedAt = NaN;
  s.maxDThisRep = 0;
  for (let i = 0; i < SOURCE_COUNT; i++) {
    s.srcX[i] = NaN;
    s.srcY[i] = NaN;
  }
}

function resetHold(s: HeadDetectorState): void {
  'worklet';
  s.calSX = emptyPerSource();
  s.calSY = emptyPerSource();
  s.calScale = [];
  s.calStartedAt = NaN;
  s.calProgress = 0;
  for (let i = 0; i < SOURCE_COUNT; i++) {
    s.calMinX[i] = NaN;
    s.calMaxX[i] = NaN;
    s.calMinY[i] = NaN;
    s.calMaxY[i] = NaN;
  }
}

/**
 * Raw position of each tracked source this frame, or null where unusable.
 *
 * Index 0/1 are the left/right shoulders. Index 2 is the face midpoint (mean
 * of the confident subset of nose and eyes) — a last resort for when neither
 * shoulder is visible, because in a plank the face points at the floor and its
 * keypoints are poor.
 */
function sourcePositions(
  frame: PoseFrame,
  minConfidence: number,
  out: ({ x: number; y: number; score: number } | null)[],
): void {
  'worklet';
  const l = frame.keypoints[KEYPOINT.LEFT_SHOULDER];
  const r = frame.keypoints[KEYPOINT.RIGHT_SHOULDER];
  out[0] = l != null && l.score >= minConfidence ? { x: l.x, y: l.y, score: l.score } : null;
  out[1] = r != null && r.score >= minConfidence ? { x: r.x, y: r.y, score: r.score } : null;

  let fx = 0;
  let fy = 0;
  let fs = 0;
  let fn = 0;
  const face = [KEYPOINT.NOSE, KEYPOINT.LEFT_EYE, KEYPOINT.RIGHT_EYE];
  for (let i = 0; i < face.length; i++) {
    const k = frame.keypoints[face[i]];
    if (k != null && k.score >= minConfidence) {
      fx += k.x;
      fy += k.y;
      fs += k.score;
      fn++;
    }
  }
  out[2] = fn > 0 ? { x: fx / fn, y: fy / fn, score: fs / fn } : null;
}

/**
 * Body scale for normalising displacement: shoulder width when both shoulders
 * are visible, torso length otherwise (the side-on case).
 *
 * Computed directly from the shoulder keypoints rather than via measureBody,
 * which also demands a visible hip. Close to the camera the hips are cropped
 * out of frame while the shoulders are perfectly visible, and requiring hips
 * there made reference capture restart every frame.
 */
function bodyScale(frame: PoseFrame, minConfidence: number): number {
  'worklet';
  const l = frame.keypoints[KEYPOINT.LEFT_SHOULDER];
  const r = frame.keypoints[KEYPOINT.RIGHT_SHOULDER];
  if (l != null && r != null && l.score >= minConfidence && r.score >= minConfidence) {
    const w = distance(l, r);
    if (w > 0) return w;
  }
  const body = measureBody(frame, minConfidence);
  if (!body.ok) return NaN;
  if (body.shoulderWidth > 0) return body.shoulderWidth;
  return body.torsoLength;
}

/** EMA weight for a frame interval, matching geometry.emaAlphaForDt. */
function alphaFor(dtMs: number, tauMs: number): number {
  'worklet';
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

/**
 * Feeds one frame into the stillness hold. Returns true when the hold has
 * lasted `calibrationMs` — the caller then commits the captured reference.
 *
 * Stillness is judged per source: each source's own trajectory must stay
 * inside a small box. A source dropping out and back in creates no spread, so
 * confidence flicker cannot restart the hold the way it did when sources were
 * blended into one midpoint.
 */
function updateHold(s: HeadDetectorState, frame: PoseFrame, cfg: HeadDetectorConfig): boolean {
  'worklet';
  const scale = bodyScale(frame, cfg.minScaleConfidence);
  if (!Number.isFinite(scale) || scale <= 0) {
    // The scale joints dropped out mid-hold; start over rather than average a
    // reference across two different bodies' worth of noise.
    resetHold(s);
    return false;
  }
  if (Number.isNaN(s.calStartedAt)) s.calStartedAt = frame.t;
  s.calScale.push(scale);

  for (let i = 0; i < SOURCE_COUNT; i++) {
    if (!Number.isFinite(s.srcX[i])) continue;
    s.calSX[i].push(s.srcX[i]);
    s.calSY[i].push(s.srcY[i]);
    // The negated comparisons seed NaN bounds and update in one branch.
    if (!(s.calMinX[i] <= s.srcX[i])) s.calMinX[i] = s.srcX[i];
    if (!(s.calMaxX[i] >= s.srcX[i])) s.calMaxX[i] = s.srcX[i];
    if (!(s.calMinY[i] <= s.srcY[i])) s.calMinY[i] = s.srcY[i];
    if (!(s.calMaxY[i] >= s.srcY[i])) s.calMaxY[i] = s.srcY[i];
  }

  for (let i = 0; i < SOURCE_COUNT; i++) {
    if (!Number.isFinite(s.calMinX[i])) continue;
    const spread = Math.hypot(s.calMaxX[i] - s.calMinX[i], s.calMaxY[i] - s.calMinY[i]);
    if (spread > scale * cfg.calibrationStillnessFraction) {
      resetHold(s);
      return false;
    }
  }

  const elapsed = frame.t - s.calStartedAt;
  s.calProgress = Math.min(1, elapsed / cfg.calibrationMs);
  return elapsed >= cfg.calibrationMs;
}

/**
 * Commits the hold's samples as the new reference. Returns false when too few
 * samples were collected for any source, in which case the hold restarts.
 */
function commitReference(s: HeadDetectorState, cfg: HeadDetectorConfig): boolean {
  'worklet';
  let captured = 0;
  for (let i = 0; i < SOURCE_COUNT; i++) {
    if (s.calSX[i].length >= cfg.calibrationMinSamples) {
      s.refX[i] = median(s.calSX[i]);
      s.refY[i] = median(s.calSY[i]);
      captured++;
    } else {
      s.refX[i] = NaN;
      s.refY[i] = NaN;
    }
  }
  if (captured === 0) {
    resetHold(s);
    return false;
  }
  s.refScale = median(s.calScale);
  resetHold(s);
  s.calProgress = 1;
  return true;
}

/** Scratch buffer for sourcePositions, reused across frames. */
const SCRATCH: ({ x: number; y: number; score: number } | null)[] = [null, null, null];

export function stepHeadDetector(
  s: HeadDetectorState,
  frame: PoseFrame,
  cfg: HeadDetectorConfig,
): HeadDetectorEvent[] {
  'worklet';
  const events: HeadDetectorEvent[] = [];

  const sources = SCRATCH;
  sourcePositions(frame, cfg.minHeadConfidence, sources);

  let best = 0;
  for (let i = 0; i < SOURCE_COUNT; i++) {
    const p = sources[i];
    if (p != null && p.score > best) best = p.score;
  }

  if (best <= 0) {
    s.lowConfidenceFrames++;
    if (s.tracking && s.lowConfidenceFrames >= cfg.trackingLostFrames) {
      s.tracking = false;
      // Reset rather than resume: a rep whose middle was never observed is not
      // a rep that was observed.
      resetMovement(s);
      if (!s.calibrated || !s.inPosition) resetHold(s);
      events.push({ type: 'trackingLost', t: frame.t });
    }
    return events;
  }
  s.lowConfidenceFrames = 0;
  s.headScore = best;
  if (!s.tracking) {
    s.tracking = true;
    events.push({ type: 'trackingRegained', t: frame.t });
  }

  const dt = Number.isFinite(s.lastFrameT) ? frame.t - s.lastFrameT : NaN;
  s.lastFrameT = frame.t;

  // Light positional smoothing per source. The excursion of a rep dwarfs
  // keypoint jitter, so this needs to remove only single-frame noise. A source
  // that vanishes restarts its EMA at the next sighting rather than dragging a
  // stale position across the gap.
  const a = alphaFor(dt, cfg.smoothingTauMs);
  for (let i = 0; i < SOURCE_COUNT; i++) {
    const p = sources[i];
    if (p == null) {
      s.srcX[i] = NaN;
      s.srcY[i] = NaN;
    } else if (Number.isFinite(s.srcX[i])) {
      s.srcX[i] += a * (p.x - s.srcX[i]);
      s.srcY[i] += a * (p.y - s.srcY[i]);
    } else {
      s.srcX[i] = p.x;
      s.srcY[i] = p.y;
    }
  }

  // --- Initial reference: captured silently from the first stillness --------
  // No ceremony: settling into a plank IS the hold. An instructed hold step
  // plus a demonstration rep were the dominant failure mode in the field.
  if (!s.calibrated) {
    if (updateHold(s, frame, cfg) && commitReference(s, cfg)) {
      s.calibrated = true;
      s.depthD = cfg.defaultDepthD;
      s.repDepths = [];
      s.phase = 'unknown';
      s.inPosition = true;
      events.push({ type: 'calibrated', t: frame.t });
      events.push({ type: 'positionAcquired', t: frame.t });
    }
    return events;
  }

  if (!Number.isFinite(s.refScale)) return events;

  // Normalised displacement — the one signal everything below runs on. Each
  // visible source is measured against ITS OWN reference and the estimates are
  // averaged: they all ride the same torso, so which of them happen to be
  // visible cannot change the value discontinuously. The divisor is the
  // *captured* scale, deliberately: the live scale changes as the body moves,
  // and feeding that back would distort the very signal being read.
  let dSum = 0;
  let dN = 0;
  for (let i = 0; i < SOURCE_COUNT; i++) {
    if (!Number.isFinite(s.srcX[i]) || !Number.isFinite(s.refX[i])) continue;
    const dx = s.srcX[i] - s.refX[i];
    const dy = s.srcY[i] - s.refY[i];
    dSum += Math.hypot(dx, dy) / s.refScale;
    dN++;
  }
  if (dN === 0) {
    // Sources are visible but none of them has a reference (e.g. references on
    // shoulders, now only the face is in view). No displacement can be
    // computed, which is a tracking gap like any other.
    s.lowConfidenceFrames++;
    if (s.tracking && s.lowConfidenceFrames >= cfg.trackingLostFrames) {
      s.tracking = false;
      resetMovement(s);
      events.push({ type: 'trackingLost', t: frame.t });
    }
    return events;
  }
  const d = dSum / dN;
  s.d = d;

  const D = s.depthD;
  const dipAt = D * cfg.dipFraction;
  const completeAt = D * cfg.completeFraction;
  const wanderAt = D * cfg.wanderFraction;

  // --- Out of position: recover by proximity or by a fresh stillness hold ---
  // The reference survives brief excursions (d returns small and counting
  // resumes), but a moved phone or a shifted setup makes the old reference
  // permanently wrong. Holding still for the same calibrationMs captures a new
  // one in place — the session self-heals instead of demanding a manual reset.
  if (!s.inPosition) {
    if (d <= completeAt) {
      resetHold(s);
      s.inPosition = true;
      s.phase = 'top';
      events.push({ type: 'positionAcquired', t: frame.t });
    } else if (updateHold(s, frame, cfg) && commitReference(s, cfg)) {
      s.inPosition = true;
      s.phase = 'unknown';
      events.push({ type: 'positionAcquired', t: frame.t });
    }
    return events;
  }

  // Left the position entirely. Standing up sweeps the torso far beyond any
  // rep's excursion, which is what distinguishes it from a deep rep without
  // needing a posture model at all.
  if (d > wanderAt) {
    if (s.phase === 'dip') {
      const durationMs = Number.isNaN(s.descentStartedAt) ? 0 : frame.t - s.descentStartedAt;
      events.push({ type: 'rejected', reason: 'wanderedOff', durationMs, t: frame.t });
    }
    s.inPosition = false;
    resetMovement(s);
    resetHold(s);
    events.push({ type: 'positionLost', t: frame.t });
    return events;
  }

  if (s.phase === 'unknown') {
    // Only start counting from a settled top, so a session resuming mid-rep
    // does not award half a movement.
    if (d <= completeAt) s.phase = 'top';
    return events;
  }

  if (s.phase === 'top') {
    if (d <= D * cfg.refAdaptMaxFraction) {
      // Resting at the top: let each reference follow its source slowly, so a
      // shuffled knee or settled shoulder does not become permanent "depth".
      // The time constant is far above a rep's period, so real reps are not
      // absorbed.
      const ra = alphaFor(dt, cfg.refAdaptTauMs);
      for (let i = 0; i < SOURCE_COUNT; i++) {
        if (!Number.isFinite(s.srcX[i]) || !Number.isFinite(s.refX[i])) continue;
        s.refX[i] += ra * (s.srcX[i] - s.refX[i]);
        s.refY[i] += ra * (s.srcY[i] - s.refY[i]);
      }
      // Settled again: any earlier sortie below was a wobble, not a descent.
      s.descentStartedAt = NaN;
    } else if (Number.isNaN(s.descentStartedAt) && d >= completeAt) {
      // The descent clock starts when the torso leaves the top band, not when
      // it reaches the dip threshold — at speed the dip-to-complete span is
      // only a fraction of the cycle, which made real fast reps measure as
      // implausibly quick and get rejected.
      s.descentStartedAt = frame.t;
    }
    if (d >= dipAt) {
      s.phase = 'dip';
      if (Number.isNaN(s.descentStartedAt)) s.descentStartedAt = frame.t;
      s.maxDThisRep = d;
    }
    return events;
  }

  // phase === 'dip'
  if (d > s.maxDThisRep) s.maxDThisRep = d;

  // Complete on rebound from the depth actually reached, or on the absolute
  // return threshold — whichever is easier. The rebound is what lets a fast
  // set, which never fully returns to the top between reps, register each rep;
  // the hysteresis floor keeps the completion from sitting close enough to the
  // dip threshold for jitter to re-trigger a descent.
  const reboundAt = s.maxDThisRep * (1 - cfg.reboundFraction);
  const finishAt = Math.min(
    Math.max(completeAt, reboundAt),
    dipAt - D * cfg.minHysteresisFraction,
  );
  if (d > finishAt) return events;

  // Back at the top: the rep is over.
  const startedAt = Number.isNaN(s.descentStartedAt) ? frame.t : s.descentStartedAt;
  const durationMs = frame.t - startedAt;
  const maxD = s.maxDThisRep;
  s.phase = 'top';
  s.descentStartedAt = NaN;
  s.maxDThisRep = 0;

  if (durationMs < cfg.minRepMs) {
    events.push({ type: 'rejected', reason: 'tooFast', durationMs, t: frame.t });
    return events;
  }
  if (durationMs > cfg.maxRepMs) {
    events.push({ type: 'rejected', reason: 'tooSlow', durationMs, t: frame.t });
    return events;
  }

  // Score against the estimate as it stood for this rep, then adapt it. The
  // median over a window means one anomalous excursion cannot poison the
  // thresholds the way a mismeasured demonstration rep once did.
  const depth = maxD / D;
  const valid = depth >= cfg.fullDepthFraction;
  if (valid || cfg.countShallowReps) s.reps++;
  if (!valid) s.partials++;
  s.lastRepValid = valid;
  s.lastRepDepth = depth;
  s.lastRepDurationMs = durationMs;

  s.repDepths.push(maxD);
  if (s.repDepths.length > cfg.depthWindow) s.repDepths.shift();
  const est = median(s.repDepths);
  s.depthD = Math.min(cfg.maxDepthD, Math.max(cfg.minDepthD, est));

  events.push({
    type: 'rep',
    index: s.reps,
    valid,
    depth,
    durationMs,
    startedAt,
    endedAt: frame.t,
  });
  return events;
}
