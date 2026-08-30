import { KEYPOINT_COUNT, type Keypoint, type PoseFrame } from '../src/pose/keypoints';
import { KEYPOINT } from '../src/pose/keypoints';

/**
 * Builds synthetic pose frames with a prescribed elbow angle, so the state machine
 * can be tested against known motion long before real fixtures exist.
 *
 * The arm is laid out as shoulder → elbow → wrist with the requested interior angle
 * at the elbow. Everything else is placed plausibly and given the same confidence.
 */
export function frameWithElbowAngle(
  t: number,
  degrees: number,
  opts: { score?: number; side?: 'left' | 'right' } = {},
): PoseFrame {
  const score = opts.score ?? 0.9;
  const side = opts.side ?? 'left';

  const blank: Keypoint = { x: 0.5, y: 0.5, score };
  const keypoints: Keypoint[] = Array.from({ length: KEYPOINT_COUNT }, () => ({ ...blank }));

  const elbow = { x: 0.5, y: 0.5 };
  const shoulder = { x: elbow.x - 0.1, y: elbow.y };
  const rad = (degrees * Math.PI) / 180;
  const wrist = {
    x: elbow.x - 0.1 * Math.cos(rad),
    y: elbow.y + 0.1 * Math.sin(rad),
  };

  const j = side === 'left'
    ? { s: KEYPOINT.LEFT_SHOULDER, e: KEYPOINT.LEFT_ELBOW, w: KEYPOINT.LEFT_WRIST }
    : { s: KEYPOINT.RIGHT_SHOULDER, e: KEYPOINT.RIGHT_ELBOW, w: KEYPOINT.RIGHT_WRIST };

  keypoints[j.s] = { ...shoulder, score };
  keypoints[j.e] = { ...elbow, score };
  keypoints[j.w] = { ...wrist, score };

  // The other side is occluded in a side-on pushup — mimic that so side selection
  // is actually exercised rather than always seeing two equally good arms.
  const other = side === 'left'
    ? [KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_ELBOW, KEYPOINT.RIGHT_WRIST]
    : [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_ELBOW, KEYPOINT.LEFT_WRIST];
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
}): PoseFrame[] {
  const { startT, bottomAngle, descentMs, ascentMs } = opts;
  const topAngle = opts.topAngle ?? 170;
  const holdMs = opts.holdMs ?? 300;
  const fps = opts.fps ?? 30;
  const step = 1000 / fps;

  const frames: PoseFrame[] = [];
  let t = startT;

  for (let e = 0; e < holdMs; e += step) frames.push(frameWithElbowAngle(t + e, topAngle));
  t += holdMs;

  for (let e = 0; e < descentMs; e += step) {
    const p = e / descentMs;
    frames.push(frameWithElbowAngle(t + e, topAngle + (bottomAngle - topAngle) * p));
  }
  t += descentMs;

  for (let e = 0; e < ascentMs; e += step) {
    const p = e / ascentMs;
    frames.push(frameWithElbowAngle(t + e, bottomAngle + (topAngle - bottomAngle) * p));
  }
  t += ascentMs;

  // Settle at the top so the smoothed angle actually crosses upAngle.
  for (let e = 0; e < holdMs; e += step) frames.push(frameWithElbowAngle(t + e, topAngle));

  return frames;
}
