import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePreviewOutput,
} from 'react-native-vision-camera';
import type { TargetCameraPosition } from 'react-native-vision-camera';

import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { usePoseCamera } from '../src/pose/usePoseCamera';
import { SkeletonOverlay } from '../src/ui/SkeletonOverlay';
import type { InputRotation } from '../src/pose/model';
import { DEFAULT_CONFIG } from '../src/reps/config';

const ROTATIONS: InputRotation[] = [0, 90, 180, 270];

export default function Session() {
  const router = useRouter();
  useKeepAwake();

  const { hasPermission, requestPermission } = useCameraPermission();

  // Back camera is the better sensor and the one used for real sets with the
  // phone on the floor. Front is for framing yourself while setting up.
  const [position, setPosition] = useState<TargetCameraPosition>('back');
  const device = useCameraDevice(position);

  // The front preview is mirrored; whether the frame buffer is mirrored too is
  // platform-dependent. Toggle rather than guess - a wrong guess looks exactly
  // like the model failing to track.
  const [mirrorOverlay, setMirrorOverlay] = useState(false);

  // The accuracy spike: MoveNet is trained on upright people, and a pushup is
  // horizontal. This cycles the input rotation so the effect can be seen live.
  const [rotationIndex, setRotationIndex] = useState(0);
  const rotation = ROTATIONS[rotationIndex];

  const { frameOutput, pose, readout, manualAdjustment, resetReps, adjustReps, modelState, modelError } =
    usePoseCamera({ rotation });
  const previewOutput = usePreviewOutput();

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Sample shared values at ~10Hz rather than reacting per frame: the numbers
  // are unreadable faster than that, and it keeps 30fps of keypoints off the JS
  // thread entirely.
  // The rep count is driven by a reaction rather than the 10Hz poll below, so it
  // updates the moment a rep lands instead of up to 100ms later. That delay was
  // small but it is the one number the user is actually watching.
  const [liveReps, setLiveReps] = useState(0);
  useAnimatedReaction(
    () => readout.value.reps + manualAdjustment.value,
    (count, previous) => {
      if (count !== previous) runOnJS(setLiveReps)(Math.max(0, count));
    },
    [],
  );

  const lastLog = useRef(0);
  const [debug, setDebug] = useState({
    ms: 0, tracked: 0, best: 0, margin: 1, fps: 0, orientation: 'up' as string,
  });
  const [reps, setReps] = useState({
    reps: 0,
    detected: 0,
    partials: 0,
    phase: 'unknown' as string,
    angle: NaN,
    depth: NaN,
    tracking: false,
    rejection: null as string | null,
    inPosition: false,
    calibrating: true,
    calProgress: 0,
    measuringRange: false,
    top: NaN,
    bottom: NaN,
    delta: NaN,
    scale: NaN,
    down: NaN,
    bodyTravel: 0,
    handTravel: 0,
    travelNeeded: NaN,
  });

  useEffect(() => {
    const id = setInterval(() => {
      const snap = pose.value;
      const scores = snap.keypoints.map((k) => k.score);
      // How close the detected body sits to the frame edge. Losing the person at
      // the bottom of a rep is usually them leaving the view, not the model
      // failing, and the two need opposite fixes.
      const seen = snap.keypoints.filter((k) => k.score >= 0.3);
      const margin = seen.length
        ? Math.min(...seen.map((k) => Math.min(k.x, 1 - k.x, k.y, 1 - k.y)))
        : 1;
      setDebug({
        orientation: snap.orientation as string,
        fps: snap.frameIntervalMs > 0 ? 1000 / snap.frameIntervalMs : 0,
        ms: Math.round(snap.inferenceMs),
        tracked: scores.filter((s) => s >= 0.3).length,
        best: Math.round(Math.max(0, ...scores) * 100),
        margin,
      });

      const r = readout.value;

      // Log once a second so a closed posture gate can be diagnosed from real
      // numbers rather than guessed at. Reads as one line in the Metro output.
      const now = Date.now();
      if (now - lastLog.current > 1000) {
        lastLog.current = now;
        // Also dump the raw model output, so a detector that bails out early can
        // be told apart from a model that is producing nothing usable.
        const kp = snap.keypoints;
        const top = scores.map((v, i) => [i, v] as const)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([i, v]) => `${i}:${v.toFixed(2)}`)
          .join(' ');
        console.log(
          `[posture] inPosition=${r.inPosition} ` +
            `elbow=${fmt(r.elbowAngle)} side=${r.side} phase=${r.phase} ` +
            `cal=${r.calibrating ? r.calProgress.toFixed(2) : 'done'} ` +
            `delta=${fmt(r.torsoDelta)} scale=${fmt(r.scaleRatio, 2)} ` +
            `th(up/dip/down)=${fmt(r.upThreshold)}/${fmt(r.dipThreshold)}/${fmt(r.downThreshold)} ` +
            `travel body=${r.bodyTravel.toFixed(3)}/${fmt(r.travelNeeded, 3)} hand=${r.handTravel.toFixed(3)} ` +
            `deepest=${fmt(r.dipMinAngle)} lastRep=${r.lastRepValid === null ? '-' : r.lastRepValid ? 'valid' : 'partial'}@${fmt(r.lastRepDepth)} ` +
            `reps=${r.reps}/${r.partials} ` +
            `| model: best3=${top} nose=${kp[0] ? kp[0].score.toFixed(2) : 'n/a'} ` +
            `Lsh=${kp[5] ? kp[5].score.toFixed(2) : 'n/a'} Lel=${kp[7] ? kp[7].score.toFixed(2) : 'n/a'} ` +
            `Lwr=${kp[9] ? kp[9].score.toFixed(2) : 'n/a'} Lhip=${kp[11] ? kp[11].score.toFixed(2) : 'n/a'} ` +
            `| xy0=${kp[0] ? kp[0].x.toFixed(2) + ',' + kp[0].y.toFixed(2) : 'n/a'} ` +
            `ms=${Math.round(snap.inferenceMs)} dt=${Math.round(snap.frameIntervalMs)}ms ` +
            `fps=${snap.frameIntervalMs > 0 ? (1000 / snap.frameIntervalMs).toFixed(1) : '--'} ` +
            `frame=${snap.frameWidth}x${snap.frameHeight} orient=${snap.orientation}`,
        );
      }

      setReps({
        reps: Math.max(0, r.reps + manualAdjustment.value),
        detected: r.reps,
        partials: r.partials,
        phase: r.phase,
        angle: r.elbowAngle,
        depth: r.dipMinAngle,
        tracking: r.tracking,
        rejection: r.lastRejection,
        inPosition: r.inPosition,
        calibrating: r.calibrating,
        calProgress: r.calProgress,
        measuringRange: r.measuringRange,
        top: r.topElbowAngle,
        bottom: r.bottomElbowAngle,
        delta: r.torsoDelta,
        scale: r.scaleRatio,
        down: r.downThreshold,
        bodyTravel: r.bodyTravel,
        handTravel: r.handTravel,
        travelNeeded: r.travelNeeded,
      });
    }, 100);
    return () => clearInterval(id);
  }, [pose, readout, manualAdjustment]);

  if (!hasPermission) {
    return (
      <Centered>
        <Text style={styles.notice}>Camera permission is required to count reps.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
      </Centered>
    );
  }

  if (device == null) {
    return (
      <Centered>
        <Text style={styles.notice}>No {position} camera found on this device.</Text>
        <Pressable
          style={styles.button}
          onPress={() => setPosition((p) => (p === 'back' ? 'front' : 'back'))}
        >
          <Text style={styles.buttonText}>Try the other camera</Text>
        </Pressable>
      </Centered>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[previewOutput, frameOutput]}
        resizeMode="cover"
        mirrorMode="auto"
      />
      <SkeletonOverlay pose={pose} mirrorX={mirrorOverlay} />

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.debugPanel}>
          <Text style={styles.debugText}>
            phase: {reps.phase}{reps.tracking ? '' : '  (no tracking)'}
          </Text>
          <Text style={styles.debugText}>
            torso drift: {fmtDeg(reps.delta)} (max {DEFAULT_CONFIG.torsoToleranceDeg}°){'  '}
            scale: {Number.isFinite(reps.scale) ? reps.scale.toFixed(2) : '--'}
          </Text>
          <Text style={styles.debugText}>
            position: {reps.calibrating ? 'CALIBRATING' : reps.inPosition ? 'OK' : 'LOST'}
          </Text>
          <Text style={styles.debugText}>
            elbow: {Number.isNaN(reps.angle) ? '--' : Math.round(reps.angle)}°
          </Text>
          <Text style={styles.debugText}>
            deepest: {Number.isFinite(reps.depth) ? Math.round(reps.depth) + '°' : '--'}
            {'  '}need &lt;= {fmtDeg(reps.down)}
          </Text>
          <Text style={styles.debugText}>
            range: {fmtDeg(reps.top)} → {fmtDeg(reps.bottom)}
          </Text>
          <Text style={styles.debugText}>
            body moved: {reps.bodyTravel.toFixed(3)}{'  '}need {fmt(reps.travelNeeded, 3)}
          </Text>
          <Text style={styles.debugText}>
            hands moved: {reps.handTravel.toFixed(3)}{'  '}(body must exceed 1.5x)
          </Text>
          {reps.rejection ? (
            <Text style={styles.warnText}>
              rejected: {reps.rejection === 'noMovement'
                ? 'body did not move'
                : reps.rejection === 'handsMoved'
                  ? 'hands moved, not a pushup'
                  : reps.rejection}
            </Text>
          ) : null}
          <Text style={styles.debugText}>model: {modelState}</Text>
          <Text style={styles.debugText}>
            inference: {debug.ms} ms{'  '}camera: {debug.fps.toFixed(0)} fps
          </Text>
          <Text style={styles.debugText}>
            joints tracked: {debug.tracked}/17{'  '}edge: {debug.margin.toFixed(2)}
            {'  '}orient: {debug.orientation}
          </Text>
          <Text style={styles.debugText}>best score: {debug.best}%</Text>
          <Text style={styles.debugText}>camera: {position}</Text>
          {modelError ? <Text style={styles.errorText}>{String(modelError)}</Text> : null}
        </View>

        <View style={styles.counterWrap} pointerEvents="none">
          {debug.best >= 35 && debug.margin < 0.04 ? (
            <Text style={styles.alert}>
              You&apos;re at the edge of the frame.{'\n'}
              Move the phone back or further to your side.
            </Text>
          ) : debug.best < 35 ? (
            // Distinguish "the camera cannot see you" from "your position is
            // wrong". They look identical on screen but need opposite fixes.
            <Text style={styles.alert}>
              Camera can&apos;t see a person ({debug.best}% confidence).{'\n'}
              Prop the phone up so it points at you.
            </Text>
          ) : reps.calibrating ? (
            <>
              <Text style={styles.prompt}>
                Step 1 — hold the top of a pushup
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${reps.calProgress * 100}%` }]} />
              </View>
            </>
          ) : reps.measuringRange ? (
            <Text style={styles.prompt}>
              Step 2 — do one slow pushup{'\n'}
              <Text style={styles.promptSub}>to measure your range in this view</Text>
            </Text>
          ) : !reps.inPosition ? (
            <Text style={styles.prompt}>Back into position</Text>
          ) : null}
          <Text style={styles.counter}>{liveReps}</Text>
          <Text style={styles.counterLabel}>
            reps{reps.partials > 0 ? `   ·   ${reps.partials} shallow` : ''}
          </Text>
          <AngleBar angle={reps.angle} />
        </View>

        <View style={styles.controls}>
          <Pressable style={[styles.button, styles.adjust]} onPress={() => adjustReps(-1)}>
            <Text style={styles.buttonText}>−1</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.adjust]} onPress={() => adjustReps(1)}>
            <Text style={styles.buttonText}>+1</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={resetReps}>
            <Text style={styles.buttonText}>recalibrate</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => setPosition((p) => (p === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.buttonText}>flip camera</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => setRotationIndex((i) => (i + 1) % ROTATIONS.length)}
          >
            <Text style={styles.buttonText}>rotate: {rotation}°</Text>
          </Pressable>
          <Pressable
            style={[styles.button, mirrorOverlay ? undefined : styles.secondary]}
            onPress={() => setMirrorOverlay((m) => !m)}
          >
            <Text style={styles.buttonText}>mirror</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Finish</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Shows the elbow angle against the two thresholds the state machine uses.
 *
 * This is what makes a miscount diagnosable: if the marker never crosses into
 * the green zone the descent was too shallow, and if it never returns to the top
 * zone the lockout was never reached. Either explains a rep that did not count.
 */
function AngleBar({ angle }: { angle: number }) {
  if (Number.isNaN(angle)) return <View style={styles.bar} />;
  const MIN = 40;
  const MAX = 180;
  const pct = Math.max(0, Math.min(1, (angle - MIN) / (MAX - MIN)));
  const downPct = (DEFAULT_CONFIG.downAngle - MIN) / (MAX - MIN);
  const upPct = (DEFAULT_CONFIG.upAngle - MIN) / (MAX - MIN);

  return (
    <View style={styles.bar}>
      <View style={[styles.zone, { left: '0%', width: `${downPct * 100}%`, backgroundColor: '#16a34a' }]} />
      <View style={[styles.zone, { left: `${upPct * 100}%`, right: 0, backgroundColor: '#2563eb' }]} />
      <View style={[styles.marker, { left: `${pct * 100}%` }]} />
    </View>
  );
}

function fmtDeg(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)}°` : '--';
}

function fmt(v: number, digits = 0): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '--';
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.container, styles.centered]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  notice: { color: '#fff', fontSize: 16, textAlign: 'center' },
  hud: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between', padding: 16 },
  debugPanel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  debugText: { color: '#7dd3fc', fontSize: 13, fontVariant: ['tabular-nums'] },
  errorText: { color: '#fca5a5', fontSize: 12 },
  warnText: { color: '#fcd34d', fontSize: 12 },
  counterWrap: { alignItems: 'center', gap: 2 },
  counter: {
    color: '#fff',
    fontSize: 96,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 8,
  },
  counterLabel: { color: '#d1d5db', fontSize: 15, letterSpacing: 1.5, textTransform: 'uppercase' },
  alert: {
    color: '#f87171',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 6,
  },
  progressTrack: {
    width: 220,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fcd34d' },
  promptSub: { color: '#fde68a', fontSize: 13, fontWeight: '500' },
  prompt: {
    color: '#fcd34d',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 6,
  },
  bar: {
    marginTop: 10,
    width: 260,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  zone: { position: 'absolute', top: 0, bottom: 0, opacity: 0.55 },
  marker: {
    position: 'absolute',
    width: 4,
    top: -3,
    bottom: -3,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  controls: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10 },
  secondary: { backgroundColor: '#374151' },
  adjust: { backgroundColor: '#4b5563', minWidth: 56, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
