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

import { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput, type CameraOrientation } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { usePoseModel } from './usePoseModel';

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
import {
  createHeadDetectorState,
  stepHeadDetector,
  HEAD_DEFAULT_CONFIG,
  type HeadDetectorState,
} from '../reps/headDetector';

export type PoseSnapshot = {
  keypoints: Keypoint[];
  /** Source frame dimensions, needed to map keypoints into preview coordinates. */
  frameWidth: number;
  frameHeight: number;
  /** Milliseconds spent in resize + inference for the last processed frame. */
  inferenceMs: number;
  /**
   * Milliseconds between the last two processed frames.
   *
   * Distinct from inference time: the camera itself slows down in dim light as
   * auto-exposure lengthens each exposure, which costs samples per rep and adds
   * motion blur. Inference being fast does not mean frames are arriving fast.
   */
  frameIntervalMs: number;
  /**
   * How the frame's pixels are rotated relative to upright.
   *
   * VisionCamera delivers buffers in sensor orientation, and documents that the
   * consumer must interpret the pixels as rotated by this value. Keypoints come
   * back in that same rotated space, so anything drawing them over the preview
   * has to counter-rotate first or the overlay is mirrored or sideways.
   */
  orientation: CameraOrientation;
};

export function emptySnapshot(): PoseSnapshot {
  'worklet';
  return {
    keypoints: createKeypointBuffer(),
    frameWidth: 0,
    frameHeight: 0,
    inferenceMs: 0,
    frameIntervalMs: 0,
    orientation: 'up',
  };
}

/** What the HUD needs from the detector, published once per processed frame. */
export type RepReadout = {
  reps: number;
  partials: number;
  phase: HeadDetectorState['phase'];
  tracking: boolean;
  /** Whether the body is near enough its reference to be counted. */
  inPosition: boolean;
  /** True until the first reference has been captured from stillness. */
  calibrating: boolean;
  /** Stillness-hold progress 0..1 while capturing or re-capturing a reference. */
  calProgress: number;
  /** Current head displacement from the top reference, in body-scale units. */
  d: number;
  /** Adaptive rep depth estimate, in body-scale units. */
  depthD: number;
  /** Deepest displacement of the rep in progress, in body-scale units. */
  maxDThisRep: number;
  /** Confidence of the head reading, the signal everything runs on. */
  headScore: number;
  lastRepValid: boolean | null;
  /** Deepest point of the last rep as a fraction of demonstrated depth. */
  lastRepDepth: number;
  lastRepDurationMs: number;
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
    tracking: false,
    inPosition: false,
    calibrating: true,
    calProgress: 0,
    d: NaN,
    depthD: NaN,
    maxDThisRep: 0,
    headScore: 0,
    lastRepValid: null,
    lastRepDepth: NaN,
    lastRepDurationMs: NaN,
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
  /**
   * Which detector shape `detector` holds. The camera runtime's global outlives
   * a JS reload, so after swapping detector implementations the old state
   * object is still there — same field names, wrong shape — and the new
   * detector reads it as "calibrated, but with no reference" and silently
   * counts nothing forever. A kind stamp makes stale state detectable.
   */
  kind: string;
  owner: string;
  detector: HeadDetectorState;
  keypoints: Keypoint[];
  rotated: Uint8Array;
  frame: PoseFrame;
  frameCount: number;
  resetEpoch: number;
  lastFrameAt: number;
  lastRejection: string | null;
};

export type UsePoseCameraOptions = {
  /** Quarter turns applied to the model input. */
  rotation?: InputRotation;
  /** Run inference on every Nth frame. 1 = every frame. */
  frameStride?: number;
};

export function usePoseCamera({ rotation = 0, frameStride = 1 }: UsePoseCameraOptions = {}) {
  // Camera runtime globals can survive navigation. A new workout owns fresh
  // counters; a React re-render within the same workout keeps them intact.
  const [owner] = useState(() => `camera-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const model = usePoseModel();

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
  const manualAdjustment = useSharedValue(0);

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
        if (st == null || st.kind !== 'head-v3' || st.owner !== owner) {
          st = {
            kind: 'head-v3',
            owner,
            detector: createHeadDetectorState(),
            keypoints: createKeypointBuffer(),
            rotated: new Uint8Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * MODEL_CHANNELS),
            frame: { t: 0, keypoints: [] },
            frameCount: 0,
            resetEpoch: 0,
            lastFrameAt: NaN,
            lastRejection: null,
          };
          st.frame.keypoints = st.keypoints;
          g.__poseState = st;
        }

        const epoch = resetEpoch.value;
        if (epoch !== st.resetEpoch) {
          st.resetEpoch = epoch;
          const previous = st.detector;
          st.detector = createHeadDetectorState();
          // Recalibrate position/depth without discarding this workout's effort.
          st.detector.reps = previous.reps;
          st.detector.partials = previous.partials;
          st.lastRejection = null;
        }

        const n = (st.frameCount + 1) % frameStride;
        st.frameCount = n;
        if (n !== 0) return;

        const started = performance.now();
        const interval = Number.isFinite(st.lastFrameAt) ? started - st.lastFrameAt : 0;
        st.lastFrameAt = started;

        const gpuFrame = resizer.resize(frame);
        try {
          const raw = new Uint8Array(gpuFrame.getPixelBuffer());
          const input = rotateSquareRgb(raw, st.rotated, MODEL_INPUT_SIZE, rotation);

          const outputs = loadedModel.runSync([input.buffer as ArrayBuffer]);
          const values = new Float32Array(outputs[0]);

          decodeMoveNet(values, st.keypoints);
          unrotateKeypoints(st.keypoints, rotation);

          st.frame.t = frame.timestamp * TIMESTAMP_TO_MS;
          const events = stepHeadDetector(st.detector, st.frame, HEAD_DEFAULT_CONFIG);

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
            frameIntervalMs: interval,
            orientation: frame.orientation,
          };
          readout.value = {
            reps: d.reps,
            partials: d.partials,
            phase: d.phase,
            tracking: d.tracking,
            inPosition: d.inPosition,
            calibrating: !d.calibrated,
            calProgress: d.calProgress,
            d: d.d,
            depthD: d.depthD,
            maxDThisRep: d.maxDThisRep,
            headScore: d.headScore,
            lastRepValid: d.lastRepValid,
            lastRepDepth: d.lastRepDepth,
            lastRepDurationMs: d.lastRepDurationMs,
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

  // Manual correction. However good the detector gets, it will sometimes be
  // wrong, and a user who cannot fix the number stops trusting the whole app.
  // Applied on top of the detected count rather than inside the detector, so a
  // correction is never undone by the next frame's publication.
  const adjustReps = (delta: number) => {
    manualAdjustment.value = Math.max(manualAdjustment.value + delta, -readout.value.reps);
  };

  const modelError = useMemo(
    () => (model.state === 'error' ? model.error : undefined),
    [model],
  );

  return {
    frameOutput,
    pose,
    readout,
    manualAdjustment,
    resetReps,
    adjustReps,
    modelState: model.state,
    modelError,
    resizerReady: resizer != null,
  };
}
