import { KEYPOINT_COUNT, type Keypoint, type PoseFrame } from '../src/pose/keypoints';
import { KEYPOINT } from '../src/pose/keypoints';

/**
 * Builds synthetic pose frames with a prescribed elbow angle, so the state machine
 * can be tested against known motion long before real fixtures exist.
 *
 * The arm is laid out as shoulder → elbow → wrist with the requested interior angle
 * at the elbow. Everything else is placed plausibly and given the same confidence.
 */
export type BodyPosture =
  /** Torso horizontal and straight — a real pushup position. */
  | 'pushup'
  /** Torso vertical: sitting or standing. Arm movement here is not a pushup. */
  | 'upright'
  /** Torso horizontal but folded at the hips. */
  | 'folded'
  /** Torso horizontal but sagging — counts, with a form flag. */
  | 'sagging'
  /** Hips and knees not confidently visible. */
  | 'legsHidden';

export function frameWithElbowAngle(
  t: number,
  degrees: number,
  opts: { score?: number; side?: 'left' | 'right'; posture?: BodyPosture } = {},
): PoseFrame {
  const score = opts.score ?? 0.9;
  const side = opts.side ?? 'left';
  const posture = opts.posture ?? 'pushup';

  const blank: Keypoint = { x: 0.5, y: 0.5, score };
  const keypoints: Keypoint[] = Array.from({ length: KEYPOINT_COUNT }, () => ({ ...blank }));

  // Physical layout: the hand is planted and the body travels toward it, which
  // is what actually happens in a pushup. Holding the shoulder still and swinging
  // the wrist - the obvious way to synthesise an elbow angle - produces the
  // opposite motion and would let fixtures pass a hands-planted check that real
  // movement fails, or vice versa.
  const UPPER_ARM = 0.12;
  const half = ((degrees / 2) * Math.PI) / 180;
  const wrist = { x: 0.5, y: 0.8 };
  // Shoulder-to-wrist distance shrinks as the elbow bends, so the shoulder
  // descends toward the planted hand.
  const reach = 2 * UPPER_ARM * Math.sin(half);
  const shoulder = { x: wrist.x, y: wrist.y - reach };
  const elbow = {
    x: wrist.x + UPPER_ARM * Math.cos(half),
    y: wrist.y - UPPER_ARM * Math.sin(half),
  };

  const j =
    side === 'left'
      ? {
          s: KEYPOINT.LEFT_SHOULDER, e: KEYPOINT.LEFT_ELBOW, w: KEYPOINT.LEFT_WRIST,
          h: KEYPOINT.LEFT_HIP, k: KEYPOINT.LEFT_KNEE, a: KEYPOINT.LEFT_ANKLE,
        }
      : {
          s: KEYPOINT.RIGHT_SHOULDER, e: KEYPOINT.RIGHT_ELBOW, w: KEYPOINT.RIGHT_WRIST,
          h: KEYPOINT.RIGHT_HIP, k: KEYPOINT.RIGHT_KNEE, a: KEYPOINT.RIGHT_ANKLE,
        };

  keypoints[j.s] = { ...shoulder, score };
  keypoints[j.e] = { ...elbow, score };
  keypoints[j.w] = { ...wrist, score };
  // The head rides with the shoulders, so it travels during a rep as they do.
  keypoints[KEYPOINT.NOSE] = { x: shoulder.x + 0.06, y: shoulder.y - 0.03, score };

  // Torso and legs trail away from the arm, hanging off the moving shoulder.
  // A tight framing crops the legs but still shows the hips; torso tilt stays
  // measurable, only the straightness check is lost.
  const hipScore = score;
  const legScore = posture === 'legsHidden' ? 0.05 : score;
  if (posture === 'upright') {
    keypoints[j.h] = { x: shoulder.x, y: shoulder.y + 0.18, score: hipScore };
    keypoints[j.k] = { x: shoulder.x, y: shoulder.y + 0.34, score: legScore };
    keypoints[j.a] = { x: shoulder.x, y: shoulder.y + 0.48, score: legScore };
  } else if (posture === 'folded') {
    keypoints[j.h] = { x: shoulder.x - 0.15, y: shoulder.y, score: hipScore };
    keypoints[j.k] = { x: shoulder.x - 0.1, y: shoulder.y + 0.16, score: legScore };
    keypoints[j.a] = { x: shoulder.x - 0.02, y: shoulder.y + 0.2, score: legScore };
  } else if (posture === 'sagging') {
    keypoints[j.h] = { x: shoulder.x - 0.15, y: shoulder.y + 0.05, score: hipScore };
    keypoints[j.k] = { x: shoulder.x - 0.29, y: shoulder.y, score: legScore };
    keypoints[j.a] = { x: shoulder.x - 0.4, y: shoulder.y - 0.01, score: legScore };
  } else {
    keypoints[j.h] = { x: shoulder.x - 0.15, y: shoulder.y, score: hipScore };
    keypoints[j.k] = { x: shoulder.x - 0.29, y: shoulder.y, score: legScore };
    keypoints[j.a] = { x: shoulder.x - 0.4, y: shoulder.y, score: legScore };
  }

  // The far side is occluded in a side-on pushup — mimic that so side selection
  // is exercised rather than always seeing two equally good limbs. This must
  // cover the hip, knee and ankle too: leaving them at their default centre
  // position with full confidence makes measureBody average the real hip with a
  // phantom one, which corrupts torso direction and length.
  const other = side === 'left'
    ? [
        KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_ELBOW, KEYPOINT.RIGHT_WRIST,
        KEYPOINT.RIGHT_HIP, KEYPOINT.RIGHT_KNEE, KEYPOINT.RIGHT_ANKLE,
      ]
    : [
        KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_ELBOW, KEYPOINT.LEFT_WRIST,
        KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE, KEYPOINT.LEFT_ANKLE,
      ];
  for (const i of other) keypoints[i] = { x: 0.5, y: 0.5, score: 0.05 };

  return { t, keypoints };
}

/** Frames where nothing is confidently detected — person out of frame. */
export function blankFrame(t: number): PoseFrame {
  return {
    t,
    keypoints: Array.from({ length: KEYPOINT_COUNT }, () => ({ x: 0.5, y: 0.5, score: 0.01 })),
  };
}

/**
 * One pushup as a sequence of frames: hold at the top, descend to `bottomAngle`,
 * then return. Angles move smoothly so EMA smoothing behaves as it would on real data.
 */
export function pushupFrames(opts: {
  startT: number;
  topAngle?: number;
  bottomAngle: number;
  descentMs: number;
  ascentMs: number;
  holdMs?: number;
  fps?: number;
  posture?: BodyPosture;
}): PoseFrame[] {
  const { startT, bottomAngle, descentMs, ascentMs } = opts;
  const posture = opts.posture ?? 'pushup';
  const topAngle = opts.topAngle ?? 170;
  const holdMs = opts.holdMs ?? 300;
  const fps = opts.fps ?? 30;
  const step = 1000 / fps;

  const frames: PoseFrame[] = [];
  let t = startT;

  for (let e = 0; e < holdMs; e += step) frames.push(frameWithElbowAngle(t + e, topAngle, { posture }));
  t += holdMs;

  for (let e = 0; e < descentMs; e += step) {
    const p = e / descentMs;
    frames.push(frameWithElbowAngle(t + e, topAngle + (bottomAngle - topAngle) * p, { posture }));
  }
  t += descentMs;

  for (let e = 0; e < ascentMs; e += step) {
    const p = e / ascentMs;
    frames.push(frameWithElbowAngle(t + e, bottomAngle + (topAngle - bottomAngle) * p, { posture }));
  }
  t += ascentMs;

  // Settle at the top so the smoothed angle actually crosses upAngle.
  for (let e = 0; e < holdMs; e += step) frames.push(frameWithElbowAngle(t + e, topAngle, { posture }));

  return frames;
}
