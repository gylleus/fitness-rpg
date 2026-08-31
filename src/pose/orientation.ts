/**
 * Mapping between the camera's own frame orientation and upright display space.
 *
 * VisionCamera delivers buffers in sensor orientation and documents that the
 * consumer must interpret the pixels as rotated by `Frame.orientation`. Pose
 * keypoints come back in that same rotated space, so anything drawing them over
 * the preview must counter-rotate first — otherwise the overlay appears
 * mirrored or sideways even though the detection itself is correct.
 */

import type { CameraOrientation } from 'react-native-vision-camera';

/**
 * Rotates a normalised point out of a frame's orientation into upright space.
 *
 * `orientation` describes how the frame content is rotated relative to upright,
 * so this applies the inverse.
 */
export function counterRotate(
  x: number,
  y: number,
  orientation: CameraOrientation,
): { x: number; y: number } {
  'worklet';
  if (orientation === 'right') return { x: y, y: 1 - x };
  if (orientation === 'left') return { x: 1 - y, y: x };
  if (orientation === 'down') return { x: 1 - x, y: 1 - y };
  return { x, y };
}

/** True when the orientation swaps which frame dimension is horizontal. */
export function isQuarterTurn(orientation: CameraOrientation): boolean {
  'worklet';
  return orientation === 'left' || orientation === 'right';
}
