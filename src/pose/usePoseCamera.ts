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
import { createDetectorState, stepDetector, type DetectorState } from '../reps/detector';
import { DEFAULT_CONFIG } from '../reps/config';

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

/** What the HUD needs from the detector, sampled off the camera thread. */
export type RepReadout = {
  reps: number;
  partials: number;
  phase: DetectorState['phase'];
  elbowAngle: number;
  tracking: boolean;
  side: DetectorState['side'];
  /** Deepest angle of the rep in progress, for a live depth cue. */
  dipMinAngle: number;
  /** Why the last movement was thrown away, if it was. */
  lastRejection: string | null;
};

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

  // The detector runs on the camera thread. Its state lives in a shared value so
  // it survives between frames and can be read from the UI thread.
  const detector = useSharedValue<DetectorState>(createDetectorState());
  // Reset is requested as a flag and applied by the camera thread on its next
  // frame. Clearing the state from JS instead would race the worklet, which is
  // mid-write to the same object roughly 30 times a second.
  const resetRequested = useSharedValue(false);
  const readout = useSharedValue<RepReadout>({
    reps: 0,
    partials: 0,
    phase: 'unknown',
    elbowAngle: NaN,
    tracking: false,
    side: null,
    dipMinAngle: Infinity,
    lastRejection: null,
  });

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

        if (resetRequested.value) {
          detector.value = createDetectorState();
          resetRequested.value = false;
        }

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

          // Timestamps come from the frame itself, not wall clock: the detector's
          // duration guards must measure the movement, not how long the pipeline
          // took to get here.
          const s = detector.value;
          const events = stepDetector(s, { t: frame.timestamp, keypoints: copy }, DEFAULT_CONFIG);

          let rejection: string | null = readout.value.lastRejection;
          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type === 'rejected') rejection = e.reason;
            else if (e.type === 'rep') rejection = null;
          }

          // Reassign both rather than mutating in place, so the UI thread sees
          // the update.
          detector.value = s;
          readout.value = {
            reps: s.reps,
            partials: s.partials,
            phase: s.phase,
            elbowAngle: s.elbowAngle,
            tracking: s.tracking,
            side: s.side,
            dipMinAngle: s.dipMinAngle,
            lastRejection: rejection,
          };
        } finally {
          gpuFrame.dispose();
        }
      } finally {
        frame.dispose();
      }
    },
  });

  // Deliberately not memoised: shared values are stable across renders, so a new
  // function identity costs nothing here, and useCallback would put the shared
  // values in a dependency array that this function then mutates.
  const resetReps = () => {
    resetRequested.value = true;
  };

  return {
    frameOutput,
    pose,
    readout,
    resetReps,
    modelState: model.state,
    modelError: model.state === 'error' ? model.error : undefined,
    resizerReady: resizer != null,
  };
}
