/**
 * Wires the camera to MoveNet and the rep detector.
 *
 * Everything expensive happens on the camera thread inside a worklet. Only three
 * things cross back to JS: rep events, a throttled status tick for the HUD, and
 * the keypoints — and those travel through a Reanimated shared value rather than
 * a bridge call, because shipping 30 objects/sec across the JS boundary is what
 * makes frame processors stutter.
 */

import { useMemo } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel } from 'react-native-fast-tflite';

import { createKeypointBuffer, decodeMoveNet, MODEL_INPUT_SIZE, rotateSquareRgb, unrotateKeypoints, type InputRotation } from './model';
import { KEYPOINT_COUNT, type Keypoint } from './keypoints';

export type PoseSnapshot = {
  keypoints: Keypoint[];
  /** Source frame dimensions, needed to map keypoints into preview coordinates. */
  frameWidth: number;
  frameHeight: number;
  /** Milliseconds spent in resize + inference for the last processed frame. */
  inferenceMs: number;
};

export function emptySnapshot(): PoseSnapshot {
  'worklet';
  return { keypoints: createKeypointBuffer(), frameWidth: 0, frameHeight: 0, inferenceMs: 0 };
}

export type UsePoseCameraOptions = {
  /** Quarter turns applied to the model input. See the accuracy spike. */
  rotation?: InputRotation;
  /** Run inference on every Nth frame. 1 = every frame. */
  frameStride?: number;
};

export function usePoseCamera({ rotation = 0, frameStride = 1 }: UsePoseCameraOptions = {}) {
  const model = useTensorflowModel(
    // fast-tflite takes a Metro asset handle, which only require() produces.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/models/movenet-lightning-int8.tflite'),
    ['android-gpu'],
  );

  const { resizer } = useResizer({
    width: MODEL_INPUT_SIZE,
    height: MODEL_INPUT_SIZE,
    channelOrder: 'rgb',
    // MoveNet Lightning INT8 expects uint8 NHWC, verified against the model's
    // own input tensor spec.
    dataType: 'uint8',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });

  const pose = useSharedValue<PoseSnapshot>(emptySnapshot());

  // Scratch buffers allocated once and reused; allocating 110KB per frame on the
  // camera thread would dominate the actual inference cost.
  const scratch = useMemo(
    () => ({
      rotated: new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3),
      keypoints: createKeypointBuffer(),
    }),
    [],
  );

  const frameCounter = useSharedValue(0);
  const loadedModel = model.state === 'loaded' ? model.model : undefined;

  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    // Drop frames rather than queue them: a backlog makes the overlay lag behind
    // the person, which reads as bad tracking.
    dropFramesWhileBusy: true,
    enablePreviewSizedOutputBuffers: true,
    onFrame(frame) {
      'worklet';
      try {
        if (loadedModel == null || resizer == null) return;

        frameCounter.value = (frameCounter.value + 1) % frameStride;
        if (frameCounter.value !== 0) return;

        const started = performance.now();

        const gpuFrame = resizer.resize(frame);
        try {
          const raw = new Uint8Array(gpuFrame.getPixelBuffer());
          const input = rotateSquareRgb(raw, scratch.rotated, MODEL_INPUT_SIZE, rotation);

          const outputs = loadedModel.runSync([input.buffer as ArrayBuffer]);
          const values = new Float32Array(outputs[0]);

          decodeMoveNet(values, scratch.keypoints);
          unrotateKeypoints(scratch.keypoints, rotation);

          // Copy into a fresh array: the shared value is read on the UI thread and
          // must not alias a buffer the camera thread is about to overwrite.
          const copy: Keypoint[] = [];
          for (let i = 0; i < KEYPOINT_COUNT; i++) {
            const k = scratch.keypoints[i];
            copy.push({ x: k.x, y: k.y, score: k.score });
          }

          pose.value = {
            keypoints: copy,
            frameWidth: frame.width,
            frameHeight: frame.height,
            inferenceMs: performance.now() - started,
          };
        } finally {
          gpuFrame.dispose();
        }
      } finally {
        frame.dispose();
      }
    },
  });

  return {
    frameOutput,
    pose,
    modelState: model.state,
    modelError: model.state === 'error' ? model.error : undefined,
    resizerReady: resizer != null,
  };
}
