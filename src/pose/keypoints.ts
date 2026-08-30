/**
 * MoveNet keypoint layout and frame types.
 *
 * Pure type/constant definitions only — no native imports — so the rep detector and
 * its tests can depend on this without pulling in the camera or TFLite runtime.
 */

/**
 * MoveNet emits the 17 COCO keypoints in this fixed order.
 *
 * Note the model's output tensor packs each keypoint as (y, x, score) — y BEFORE x.
 * The loader is responsible for swapping into {x, y}; everything downstream of this
 * module assumes the conventional ordering.
 */
export const KEYPOINT = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_EAR: 3,
  RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const;

export const KEYPOINT_COUNT = 17;

export type KeypointName = keyof typeof KEYPOINT;
export type KeypointIndex = (typeof KEYPOINT)[KeypointName];

/** A single detected joint. `x`/`y` are normalised to 0..1 of the frame. */
export type Keypoint = {
  x: number;
  y: number;
  /** Model confidence, 0..1. Low-scoring keypoints are guesses and must be gated. */
  score: number;
};

/** One inference result. `t` is a monotonic timestamp in milliseconds. */
export type PoseFrame = {
  t: number;
  /** Always KEYPOINT_COUNT entries, indexed by KEYPOINT. */
  keypoints: Keypoint[];
};

/** Which arm the detector is tracking. A side view occludes the far arm entirely. */
export type Side = 'left' | 'right';

export const SIDE_JOINTS: Record<Side, { shoulder: number; elbow: number; wrist: number; hip: number; knee: number }> = {
  left: {
    shoulder: KEYPOINT.LEFT_SHOULDER,
    elbow: KEYPOINT.LEFT_ELBOW,
    wrist: KEYPOINT.LEFT_WRIST,
    hip: KEYPOINT.LEFT_HIP,
    knee: KEYPOINT.LEFT_KNEE,
  },
  right: {
    shoulder: KEYPOINT.RIGHT_SHOULDER,
    elbow: KEYPOINT.RIGHT_ELBOW,
    wrist: KEYPOINT.RIGHT_WRIST,
    hip: KEYPOINT.RIGHT_HIP,
    knee: KEYPOINT.RIGHT_KNEE,
  },
};
