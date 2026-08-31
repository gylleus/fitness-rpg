/**
 * MoveNet decoding and input preparation.
 *
 * Everything here is worklet-safe and free of native imports, so it can be unit
 * tested in Node and also run on the camera thread.
 */

import { KEYPOINT_COUNT, type Keypoint } from './keypoints';

/**
 * MoveNet Thunder takes a 256x256 RGB image.
 *
 * Lightning (192x192) was the original choice for framerate, but on a head-on
 * view at 1-2m it only cleared the confidence threshold on about half of frames,
 * which broke tracking partway down a rep. Measured inference was 8-9ms against
 * a 33ms budget, so there was ample headroom to trade for accuracy.
 */
export const MODEL_INPUT_SIZE = 256;
export const MODEL_CHANNELS = 3;

/** Quarter turns applied to the model input before inference. */
export type InputRotation = 0 | 90 | 180 | 270;

/**
 * Decodes MoveNet's `[1, 1, 17, 3]` output into keypoints.
 *
 * The model packs each keypoint as **(y, x, score)** — y first. Getting this
 * backwards produces a skeleton that looks plausible but is mirrored about the
 * diagonal, so it is worth being explicit about.
 *
 * Writes into `out` rather than allocating, because this runs every frame on the
 * camera thread and per-frame allocation is what makes frame processors stutter.
 */
export function decodeMoveNet(raw: Float32Array, out: Keypoint[]): void {
  'worklet';
  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const o = i * 3;
    out[i].y = raw[o];
    out[i].x = raw[o + 1];
    out[i].score = raw[o + 2];
  }
}

export function createKeypointBuffer(): Keypoint[] {
  'worklet';
  const out: Keypoint[] = [];
  for (let i = 0; i < KEYPOINT_COUNT; i++) out.push({ x: 0, y: 0, score: 0 });
  return out;
}

/**
 * Rotates a square interleaved RGB buffer by whole quarter turns.
 *
 * This exists for the accuracy spike: MoveNet is trained overwhelmingly on upright
 * people, and someone doing a pushup is horizontal in frame. Rotating the input so
 * the body reads upright may recover accuracy that would otherwise be lost.
 *
 * Writes into `dst` to avoid allocating a 110KB buffer every frame.
 */
export function rotateSquareRgb(
  src: Uint8Array,
  dst: Uint8Array,
  size: number,
  rotation: InputRotation,
): Uint8Array {
  'worklet';
  if (rotation === 0) return src;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Source pixel that lands at (x, y) after rotating the image clockwise.
      let sx: number;
      let sy: number;
      if (rotation === 90) {
        sx = y;
        sy = size - 1 - x;
      } else if (rotation === 180) {
        sx = size - 1 - x;
        sy = size - 1 - y;
      } else {
        sx = size - 1 - y;
        sy = x;
      }
      const d = (y * size + x) * MODEL_CHANNELS;
      const s = (sy * size + sx) * MODEL_CHANNELS;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
    }
  }
  return dst;
}

/**
 * Maps keypoints from a rotated model input back into the unrotated frame.
 *
 * Without this the skeleton would be drawn at the rotation the model saw rather
 * than the one the camera actually produced.
 */
export function unrotateKeypoints(keypoints: Keypoint[], rotation: InputRotation): void {
  'worklet';
  if (rotation === 0) return;
  for (let i = 0; i < keypoints.length; i++) {
    const k = keypoints[i];
    const x = k.x;
    const y = k.y;
    // These are the INVERSES of the forward rotations in rotateSquareRgb, not
    // the forward transforms themselves. For a clockwise 90 the forward map is
    // (dx, dy) = (1 - sy, sx), so recovering the source is (sx, sy) = (dy, 1 - dx).
    if (rotation === 90) {
      k.x = y;
      k.y = 1 - x;
    } else if (rotation === 180) {
      // Self-inverse.
      k.x = 1 - x;
      k.y = 1 - y;
    } else {
      k.x = 1 - y;
      k.y = x;
    }
  }
}
