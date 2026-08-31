/**
 * Wires the camera to MoveNet and the rep detector.
 *
 * ## Why state lives on the camera runtime, not in shared values
 *
 * The frame processor runs on its own worklet runtime. Reanimated hosts mutables
 * on the UI runtime, so from any other runtime a read is `getSync()` — a blocking
 * hop onto the UI thread — while a write is `setAsync()`, queued and applied
 * later. A read-modify-write of detector state across that boundary therefore
 * races itself: at 30fps a read routinely observes state from before a still
 * pending write, so the EMA never accumulates and the phase never advances.
 *
 * All hot state consequently lives on the camera runtime's own global, mutated in
 * place. Shared values are used only for one-way publication to the UI, where an
 * asynchronous write is exactly what we want.
 */

import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel } from 'react-native-fast-tflite';

import {
  createKeypointBuffer,
  decodeMoveNet,
  MODEL_CHANNELS,
  MODEL_INPUT_SIZE,
  rotateSquareRgb,
  unrotateKeypoints,
  type InputRotation,
} from './model';
import { KEYPOINT_COUNT, type Keypoint, type PoseFrame } from './keypoints';
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

/** What the HUD needs from the detector, published once per processed frame. */
export type RepReadout = {
  reps: number;
  partials: number;
  phase: DetectorState['phase'];
  elbowAngle: number;
  tracking: boolean;
  side: DetectorState['side'];
  /** Deepest angle of the rep in progress. Infinity between reps. */
  dipMinAngle: number;
  /** Whether the body is currently in a pushup position at all. */
  inPosition: boolean;
  /** Calibration progress 0..1 while capturing the reference position. */
  calibrating: boolean;
  calProgress: number;
  /** Demonstrating one rep so the usable range of motion can be measured. */
  measuringRange: boolean;
  topElbowAngle: number;
  bottomElbowAngle: number;
  /** How far the torso has drifted from the calibrated reference, degrees. */
  torsoDelta: number;
  /** Torso length relative to the reference. 1 means unchanged. */
  scaleRatio: number;
  upThreshold: number;
  dipThreshold: number;
  downThreshold: number;
  lastRepValid: boolean | null;
  lastRepDepth: number;
  /** Shoulder→hip→knee angle. NaN when the knee is not visible. */
  bodyLine: number;
  shoulderScore: number;
  hipScore: number;
  kneeScore: number;
  /** Raw frame geometry, to expose any buffer/preview orientation mismatch. */
  frameWidth: number;
  frameHeight: number;
  /** Why the last movement was discarded, if it was. */
  lastRejection: string | null;
};

function emptyReadout(): RepReadout {
  'worklet';
  return {
    reps: 0,
    partials: 0,
    phase: 'unknown',
    elbowAngle: NaN,
    tracking: false,
    side: null,
    dipMinAngle: Infinity,
    inPosition: false,
    calibrating: true,
    calProgress: 0,
    measuringRange: false,
    topElbowAngle: NaN,
    bottomElbowAngle: NaN,
    torsoDelta: NaN,
    scaleRatio: NaN,
    upThreshold: NaN,
    dipThreshold: NaN,
    downThreshold: NaN,
    lastRepValid: null,
    lastRepDepth: NaN,
    bodyLine: NaN,
    shoulderScore: 0,
    hipScore: 0,
    kneeScore: 0,
    frameWidth: 0,
    frameHeight: 0,
    lastRejection: null,
  };
}

/**
 * `Frame.timestamp` is a presentation timestamp in platform-native units, NOT
 * milliseconds: CameraX reports nanoseconds on Android and `CMTime.seconds`
 * gives fractional seconds on iOS. The detector's duration guards are all in ms,
 * so feeding the raw value through makes every Android rep exceed `maxRepMs`
 * (a 1s rep measures as 1e9) and every iOS frame gap collapse below
 * `minTopDwellMs`. Either way nothing is ever counted.
 */
const TIMESTAMP_TO_MS = Platform.OS === 'android' ? 1e-6 : 1e3;

/** State held on the camera runtime, keyed off its global. */
type RuntimeState = {
  detector: DetectorState;
  keypoints: Keypoint[];
  rotated: Uint8Array;
  frame: PoseFrame;
  frameCount: number;
  resetEpoch: number;
  lastRejection: string | null;
};

export type UsePoseCameraOptions = {
  /** Quarter turns applied to the model input. */
  rotation?: InputRotation;
  /** Run inference on every Nth frame. 1 = every frame. */
  frameStride?: number;
};

export function usePoseCamera({ rotation = 0, frameStride = 1 }: UsePoseCameraOptions = {}) {
  const model = useTensorflowModel(
    // fast-tflite takes a Metro asset handle, which only require() produces.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/models/movenet-thunder-int8.tflite'),
    ['android-gpu'],
  );

  const { resizer } = useResizer({
    width: MODEL_INPUT_SIZE,
    height: MODEL_INPUT_SIZE,
    channelOrder: 'rgb',
    // MoveNet Lightning INT8 expects uint8 NHWC, verified against the model's
    // own input tensor spec.
    dataType: 'uint8',
    // 'cover' crops to a centred square; 'contain' letterboxes the whole frame.
    // Contain was tried to avoid cropping a horizontal body's limbs, but it
    // costs resolution where it matters most: letterboxing 1280x720 into the
    // square leaves the subject roughly 0.56x the linear size that cropping
    // gives. For a head-on subject, who is centred anyway, the cropped edges are
    // empty floor and the resolution is worth far more.
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  });

  // Published to the UI thread only. Never read back on the camera thread.
  const pose = useSharedValue<PoseSnapshot>(emptySnapshot());
  const readout = useSharedValue<RepReadout>(emptyReadout());
  // Incremented from JS to request a reset. The worklet compares it against its
  // own copy, so a missed or repeated read is self-correcting — unlike a boolean
  // flag the worklet must clear with an asynchronous write.
  const resetEpoch = useSharedValue(0);

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

        // Created once per camera runtime and mutated in place thereafter. A
        // useMemo object captured in the closure would not do: the worklet is
        // rebuilt on every React render and its closure re-serialized, so the
        // "reused" scratch buffers would be re-copied — and any state in them
        // silently reset — at the HUD's refresh rate.
        const g = globalThis as unknown as { __poseState?: RuntimeState };
        let st = g.__poseState;
        if (st == null) {
          st = {
            detector: createDetectorState(),
            keypoints: createKeypointBuffer(),
            rotated: new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * MODEL_CHANNELS),
            frame: { t: 0, keypoints: [] },
            frameCount: 0,
            resetEpoch: 0,
            lastRejection: null,
          };
          st.frame.keypoints = st.keypoints;
          g.__poseState = st;
        }

        const epoch = resetEpoch.value;
        if (epoch !== st.resetEpoch) {
          st.resetEpoch = epoch;
          st.detector = createDetectorState();
          st.lastRejection = null;
        }

        const n = (st.frameCount + 1) % frameStride;
        st.frameCount = n;
        if (n !== 0) return;

        const started = performance.now();

        const gpuFrame = resizer.resize(frame);
        try {
          const raw = new Uint8Array(gpuFrame.getPixelBuffer());
          const input = rotateSquareRgb(raw, st.rotated, MODEL_INPUT_SIZE, rotation);

          const outputs = loadedModel.runSync([input.buffer as ArrayBuffer]);
          const values = new Float32Array(outputs[0]);

          decodeMoveNet(values, st.keypoints);
          unrotateKeypoints(st.keypoints, rotation);

          st.frame.t = frame.timestamp * TIMESTAMP_TO_MS;
          const events = stepDetector(st.detector, st.frame, DEFAULT_CONFIG);

          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type === 'rejected') st.lastRejection = e.reason;
            else if (e.type === 'rep') st.lastRejection = null;
          }

          const d = st.detector;

          // Publish a FRESH array of fresh objects every frame. The serializer
          // caches clones by object identity (cloneArray does
          // serializableMappingCache.set(value, clone)), so republishing the same
          // scratch array hands the UI the clone made on the very first frame,
          // forever — a skeleton frozen at whatever the camera saw at startup.
          // The 17 small allocations are trivial next to inference.
          const published: Keypoint[] = [];
          for (let i = 0; i < KEYPOINT_COUNT; i++) {
            const k = st.keypoints[i];
            published.push({ x: k.x, y: k.y, score: k.score });
          }

          // Both writes are asynchronous, which is fine: nothing on the camera
          // thread reads them back.
          pose.value = {
            keypoints: published,
            frameWidth: frame.width,
            frameHeight: frame.height,
            inferenceMs: performance.now() - started,
          };
          readout.value = {
            reps: d.reps,
            partials: d.partials,
            phase: d.phase,
            elbowAngle: d.elbowAngle,
            tracking: d.tracking,
            side: d.side,
            dipMinAngle: d.dipMinAngle,
            inPosition: d.inPosition,
            calibrating: d.mode === 'calibrating',
            calProgress: d.calProgress,
            measuringRange: d.mode === 'measuringRange',
            topElbowAngle: d.calibration?.topElbowAngle ?? NaN,
            bottomElbowAngle: d.calibration?.bottomElbowAngle ?? NaN,
            torsoDelta: d.torsoDelta,
            scaleRatio: d.scaleRatio,
            upThreshold: d.upThreshold,
            dipThreshold: d.dipThreshold,
            downThreshold: d.downThreshold,
            lastRepValid: d.lastRepValid,
            lastRepDepth: d.lastRepDepth,
            bodyLine: d.bodyLine,
            shoulderScore: d.shoulderScore,
            hipScore: d.hipScore,
            kneeScore: d.kneeScore,
            frameWidth: frame.width,
            frameHeight: frame.height,
            lastRejection: st.lastRejection,
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
  // function identity costs nothing, and useCallback would place the shared value
  // in a dependency array that this function then mutates.
  const resetReps = () => {
    resetEpoch.value = resetEpoch.value + 1;
  };

  const modelError = useMemo(
    () => (model.state === 'error' ? model.error : undefined),
    [model],
  );

  return {
    frameOutput,
    pose,
    readout,
    resetReps,
    modelState: model.state,
    modelError,
    resizerReady: resizer != null,
  };
}
