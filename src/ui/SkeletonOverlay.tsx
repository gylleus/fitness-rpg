/**
 * Debug overlay: draws MoveNet's keypoints and skeleton on top of the preview.
 *
 * This is the instrument for the accuracy spike. Without it there is no way to
 * tell "the model cannot see a horizontal body" apart from "the rep thresholds
 * are wrong" — both look like a counter stuck at zero.
 */

import { Canvas, Circle, Line, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useState } from 'react';

import { KEYPOINT, type Keypoint } from '../pose/keypoints';
import type { PoseSnapshot } from '../pose/usePoseCamera';

/** Pairs of keypoints drawn as bones. */
const EDGES: [number, number][] = [
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.RIGHT_SHOULDER],
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_ELBOW],
  [KEYPOINT.LEFT_ELBOW, KEYPOINT.LEFT_WRIST],
  [KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_ELBOW],
  [KEYPOINT.RIGHT_ELBOW, KEYPOINT.RIGHT_WRIST],
  [KEYPOINT.LEFT_SHOULDER, KEYPOINT.LEFT_HIP],
  [KEYPOINT.RIGHT_SHOULDER, KEYPOINT.RIGHT_HIP],
  [KEYPOINT.LEFT_HIP, KEYPOINT.RIGHT_HIP],
  [KEYPOINT.LEFT_HIP, KEYPOINT.LEFT_KNEE],
  [KEYPOINT.LEFT_KNEE, KEYPOINT.LEFT_ANKLE],
  [KEYPOINT.RIGHT_HIP, KEYPOINT.RIGHT_KNEE],
  [KEYPOINT.RIGHT_KNEE, KEYPOINT.RIGHT_ANKLE],
];

const MIN_SCORE = 0.3;

/**
 * Maps a model-space point into preview-view pixels.
 *
 * Two different crops of the same frame are involved and they are not the same:
 * the resizer takes a centre square (scaleMode 'cover'), while the preview
 * covers a view of a different aspect ratio. Skipping either step puts the
 * skeleton visibly off the body.
 */
function toView(
  k: Keypoint,
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
  mirrorX: boolean,
): { x: number; y: number } {
  'worklet';
  // The front camera preview is mirrored, but the frame buffer handed to the
  // model may not be. When they disagree the skeleton lands flipped left-right,
  // which reads as broken tracking rather than a coordinate problem.
  const kx = mirrorX ? 1 - k.x : k.x;

  // Model space -> frame pixels, undoing the centre square crop.
  const square = Math.min(frameW, frameH);
  const fx = (frameW - square) / 2 + kx * square;
  const fy = (frameH - square) / 2 + k.y * square;

  // Frame pixels -> view pixels, applying the preview's own cover crop.
  const scale = Math.max(viewW / frameW, viewH / frameH);
  return {
    x: fx * scale + (viewW - frameW * scale) / 2,
    y: fy * scale + (viewH - frameH * scale) / 2,
  };
}

export function SkeletonOverlay({
  pose,
  mirrorX = false,
}: {
  pose: SharedValue<PoseSnapshot>;
  mirrorX?: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const points = useDerivedValue(() => {
    const snap = pose.value;
    if (snap.frameWidth === 0 || size.width === 0) return [];
    return snap.keypoints.map((k) => ({
      ...toView(k, snap.frameWidth, snap.frameHeight, size.width, size.height, mirrorX),
      score: k.score,
    }));
  }, [size, mirrorX]);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {EDGES.map(([a, b], i) => (
          <Bone key={`e${i}`} points={points} a={a} b={b} />
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <Joint key={`j${i}`} points={points} index={i} />
        ))}
      </Canvas>
    </View>
  );
}

type ViewPoint = { x: number; y: number; score: number };

function Joint({ points, index }: { points: SharedValue<ViewPoint[]>; index: number }) {
  const cx = useDerivedValue(() => points.value[index]?.x ?? -100);
  const cy = useDerivedValue(() => points.value[index]?.y ?? -100);
  // Fade low-confidence joints instead of hiding them: seeing the model guess
  // is more informative than seeing nothing when debugging tracking.
  const opacity = useDerivedValue(() => {
    const s = points.value[index]?.score ?? 0;
    return s < MIN_SCORE ? 0.15 : 1;
  });
  return <Circle cx={cx} cy={cy} r={6} color="#22d3ee" opacity={opacity} />;
}

function Bone({ points, a, b }: { points: SharedValue<ViewPoint[]>; a: number; b: number }) {
  const p1 = useDerivedValue(() => {
    const p = points.value[a];
    return p ? vec(p.x, p.y) : vec(-100, -100);
  });
  const p2 = useDerivedValue(() => {
    const p = points.value[b];
    return p ? vec(p.x, p.y) : vec(-100, -100);
  });
  const opacity = useDerivedValue(() => {
    const sa = points.value[a]?.score ?? 0;
    const sb = points.value[b]?.score ?? 0;
    return Math.min(sa, sb) < MIN_SCORE ? 0.12 : 0.9;
  });
  return <Line p1={p1} p2={p2} color="#f472b6" style="stroke" strokeWidth={3} opacity={opacity} />;
}
