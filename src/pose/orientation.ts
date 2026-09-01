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
 * The eight ways a normalised image can be mapped into upright space: four
 * rotations, each optionally mirrored.
 *
 * Deriving this from `Frame.orientation` did not survive contact with the
 * device. The frame reports 'right', yet an identity mapping placed the head at
 * the bottom of the screen and the documented counter-rotation placed it at the
 * right — meaning the pixels reaching the model are not in the orientation the
 * frame advertises, most likely because the resizer normalises them on the way
 * through. Rather than keep guessing at a convention, the transform is explicit
 * and selectable, and the one that matches this pipeline is the default.
 */
export const OVERLAY_TRANSFORMS = [
  'identity',
  'flipY',
  'flipX',
  'rot180',
  'rot90',
  'rot90flip',
  'rot270',
  'rot270flip',
] as const;

export type OverlayTransform = (typeof OVERLAY_TRANSFORMS)[number];

/** Maps a normalised keypoint into upright display space. */
export function applyOverlayTransform(
  x: number,
  y: number,
  transform: OverlayTransform,
): { x: number; y: number } {
  'worklet';
  switch (transform) {
    case 'flipY':
      return { x, y: 1 - y };
    case 'flipX':
      return { x: 1 - x, y };
    case 'rot180':
      return { x: 1 - x, y: 1 - y };
    case 'rot90':
      return { x: y, y: 1 - x };
    case 'rot90flip':
      return { x: 1 - y, y: 1 - x };
    case 'rot270':
      return { x: 1 - y, y: x };
    case 'rot270flip':
      return { x: y, y: x };
    default:
      return { x, y };
  }
}

/** True when the transform swaps which frame dimension is horizontal. */
export function transformSwapsAxes(transform: OverlayTransform): boolean {
  'worklet';
  return (
    transform === 'rot90' ||
    transform === 'rot90flip' ||
    transform === 'rot270' ||
    transform === 'rot270flip'
  );
}

/**
 * Rotates a normalised point out of a frame's orientation into upright space.
 *
 * `orientation` describes how the frame content is rotated relative to upright,
 * so this applies the inverse. Kept for reference and tests; the overlay uses
 * the explicit transform above.
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
