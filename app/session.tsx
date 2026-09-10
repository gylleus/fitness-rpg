import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { OVERLAY_TRANSFORMS } from '../src/pose/orientation';
import { HEAD_DEFAULT_CONFIG } from '../src/reps/headDetector';
import { db } from '../src/db/client';
import { getSavedPushups, savePushupWorkout } from '../src/db/game';
import { useGame } from '../src/game/GameProvider';
import { Button, Card, colors, PageHeading, Screen, ui } from '../src/ui/theme';

const ROTATIONS: InputRotation[] = [0, 90, 180, 270];

export default function Session() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { perform, foreground } = useGame();
  const [startedAt] = useState(() => Date.now());
  const [sourceKey] = useState(() => `pushup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const saved = useRef(false);
  const [summary, setSummary] = useState<{ full: number; partial: number; credited: number } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  useKeepAwake();

  const { hasPermission, requestPermission } = useCameraPermission();

  // Front camera by default: it is the only way to see the screen — the rep
  // count, the calibration prompts, and the "can't see you" alert — while
  // actually doing pushups. The back camera's better sensor is worthless if
  // using it means exercising blind.
  const [position, setPosition] = useState<TargetCameraPosition>('front');
  const device = useCameraDevice(position);

  // Which mapping puts the drawn skeleton on the actual body. Derived from
  // Frame.orientation twice and wrong both times, so it is selectable until the
  // correct one for this pipeline is confirmed on a device.
  const [transformIndex, setTransformIndex] = useState(1); // 'flipY'
  const overlayTransform = OVERLAY_TRANSFORMS[transformIndex];

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
    d: NaN,
    depthD: NaN,
    maxD: 0,
    headScore: 0,
    tracking: false,
    rejection: null as string | null,
    inPosition: false,
    calibrating: true,
    calProgress: 0,
    lastValid: null as boolean | null,
    lastDepth: NaN,
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
      if (__DEV__ && now - lastLog.current > 1000) {
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
          `[head] inPosition=${r.inPosition} phase=${r.phase} ` +
            `cal=${r.calibrating ? r.calProgress.toFixed(2) : 'done'} ` +
            `d=${fmt(r.d, 2)} depthD=${fmt(r.depthD, 2)} maxD=${r.maxDThisRep.toFixed(2)} ` +
            `headScore=${r.headScore.toFixed(2)} ` +
            `lastRep=${r.lastRepValid === null ? '-' : r.lastRepValid ? 'valid' : 'shallow'}@${fmt(r.lastRepDepth, 2)} ` +
            `rej=${r.lastRejection ?? '-'} reps=${r.reps}/${r.partials} ` +
            `| model: best3=${top} nose=${kp[0] ? kp[0].score.toFixed(2) : 'n/a'} ` +
            `Lsh=${kp[5] ? kp[5].score.toFixed(2) : 'n/a'} ` +
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
        d: r.d,
        depthD: r.depthD,
        maxD: r.maxDThisRep,
        headScore: r.headScore,
        tracking: r.tracking,
        rejection: r.lastRejection,
        inPosition: r.inPosition,
        calibrating: r.calibrating,
        calProgress: r.calProgress,
        lastValid: r.lastRepValid,
        lastDepth: r.lastRepDepth,
      });
    }, 100);
    return () => clearInterval(id);
  }, [pose, readout, manualAdjustment]);

  const finish = () => {
    if (saved.current) return;
    saved.current = true;
    const full = Math.max(0, readout.value.reps + manualAdjustment.value);
    const partial = readout.value.partials;
    let credited = 0;
    const success = perform(() => {
      const before = getSavedPushups(db);
      savePushupWorkout(db, { sourceKey, startedAt, endedAt: Date.now(), validReps: full, partialReps: partial });
      credited = getSavedPushups(db) - before;
    });
    if (success) setSummary({ full, partial, credited }); else saved.current = false;
  };

  usePreventRemove(!summary && (liveReps > 0 || reps.partials > 0), ({ data: actionData }) => {
    Alert.alert('Save your pushups?', 'Finish this workout to add its reps to your history and your damage bonus.', [
      { text: 'Keep training', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(actionData.action) },
      { text: 'Save workout', onPress: finish },
    ]);
  });

  if (summary) return <Screen>
    <PageHeading eyebrow="Training / workout saved" title="A little stronger." />
    <Card><Text style={ui.label}>Pushups completed</Text><Text style={[ui.number, { fontSize: 64 }]}>{summary.full}</Text><Text style={[ui.heading, { color: colors.green }]}>+{summary.credited} pushups saved</Text><Text style={ui.body}>{summary.partial} shallow reps recorded separately. Your effort is saved on this phone.</Text><Text style={ui.small}>Every saved pushup adds 10% of your base damage before item bonuses. Pushups are never consumed, and your power carries over.</Text></Card>
    <Button label="Return to camp" onPress={() => router.replace('/')} />
    <Button secondary label="Take this power to the dungeon" onPress={() => router.replace('/dungeon')} />
  </Screen>;

  if (!hasPermission) {
    return (
      <Centered>
        <Text style={styles.notice}>Camera permission is required to count reps.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
        <Button secondary label="Back to camp" onPress={() => router.replace('/')} />
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
        <Button secondary label="Back to camp" onPress={() => router.replace('/')} />
      </Centered>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={foreground}
        outputs={[previewOutput, frameOutput]}
        resizeMode="cover"
        mirrorMode="auto"
      />
      {/* The transform covers mirroring too, so no separate mirror flag. */}
      <SkeletonOverlay pose={pose} transform={overlayTransform} />

      <View style={[styles.hud, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {showDebug ? <View style={styles.debugPanel}>
          <Text style={styles.debugText}>
            phase: {reps.phase}{reps.tracking ? '' : '  (no tracking)'}
          </Text>
          <Text style={styles.debugText}>
            position: {reps.calibrating ? 'CALIBRATING' : reps.inPosition ? 'OK' : 'LOST'}
          </Text>
          <Text style={styles.debugText}>
            head depth: {fmt(reps.d, 2)}{'  '}demo: {fmt(reps.depthD, 2)}
          </Text>
          <Text style={styles.debugText}>
            this rep: {reps.maxD > 0 && reps.depthD > 0 ? (reps.maxD / reps.depthD).toFixed(2) : '--'}
            {'  '}(full ≥ {HEAD_DEFAULT_CONFIG.fullDepthFraction})
          </Text>
          <Text style={styles.debugText}>
            last rep: {reps.lastValid === null ? '--' : reps.lastValid ? 'full' : 'shallow'}
            {Number.isFinite(reps.lastDepth) ? ` @ ${Math.round(reps.lastDepth * 100)}%` : ''}
          </Text>
          <Text style={styles.debugText}>
            head confidence: {Math.round(reps.headScore * 100)}%
          </Text>
          {reps.rejection ? (
            <Text style={styles.warnText}>
              rejected: {reps.rejection === 'wanderedOff'
                ? 'you left the pushup position'
                : reps.rejection}
            </Text>
          ) : null}
          <Text style={styles.debugText}>model: {modelState}</Text>
          <Text style={styles.debugText}>
            inference: {debug.ms} ms{'  '}camera: {debug.fps.toFixed(0)} fps
          </Text>
          <Text style={styles.debugText}>
            joints tracked: {debug.tracked}/17{'  '}edge: {debug.margin.toFixed(2)}
            {'  '}orient: {debug.orientation}{'  '}map: {overlayTransform}
          </Text>
          <Text style={styles.debugText}>best score: {debug.best}%</Text>
          <Text style={styles.debugText}>camera: {position}</Text>
          {modelError ? <Text style={styles.errorText}>{String(modelError)}</Text> : null}
        </View> : <View style={styles.debugPanel}><Text style={styles.buttonText}>PUSHUPS → DAMAGE BONUS</Text><Text style={styles.debugText}>Finish to save your workout.</Text>{modelError ? <Text style={styles.errorText}>{String(modelError)}</Text> : null}</View>}

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
          ) : reps.calibrating || !reps.inPosition ? (
            // One prompt for both first capture and re-capture: get set, be
            // still for a moment, and counting arms itself. No steps to follow.
            <>
              <Text style={styles.prompt}>
                Get into pushup position and hold still
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${reps.calProgress * 100}%` }]} />
              </View>
            </>
          ) : null}
          <Text style={styles.counter}>{liveReps}</Text>
          <Text style={styles.counterLabel}>
            reps{reps.partials > 0 ? `   ·   ${reps.partials} shallow` : ''}
          </Text>
          <DepthBar d={reps.d} depthD={reps.depthD} />
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
          <Pressable style={[styles.button, styles.secondary]} onPress={() => setShowDebug(!showDebug)}>
            <Text style={styles.buttonText}>{showDebug ? 'Hide diagnostics' : 'Camera settings'}</Text>
          </Pressable>
          {showDebug && <>
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
            style={styles.button}
            onPress={() => setTransformIndex((i) => (i + 1) % OVERLAY_TRANSFORMS.length)}
          >
            <Text style={styles.buttonText}>map: {overlayTransform}</Text>
          </Pressable>
          </>}
          <Pressable style={[styles.button, { backgroundColor: '#377c49', minWidth: 150 }]} onPress={finish}>
            <Text style={styles.buttonText}>Finish & save</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Shows head displacement against the completion and full-depth thresholds.
 *
 * This is what makes a miscount diagnosable: the marker starts in the blue
 * (top) zone, must reach the green (full depth) zone for a valid rep, and must
 * return to blue for the rep to complete. Where the marker turns around
 * explains any rep that scored shallow or did not count.
 */
function DepthBar({ d, depthD }: { d: number; depthD: number }) {
  if (!Number.isFinite(d) || !Number.isFinite(depthD) || depthD <= 0) {
    return <View style={styles.bar} />;
  }
  // Scale the bar to 1.3x the demonstrated depth so overshoot stays visible.
  const MAX = depthD * 1.3;
  const pct = Math.max(0, Math.min(1, d / MAX));
  const topPct = (depthD * HEAD_DEFAULT_CONFIG.completeFraction) / MAX;
  const fullPct = (depthD * HEAD_DEFAULT_CONFIG.fullDepthFraction) / MAX;

  return (
    <View style={styles.bar}>
      <View style={[styles.zone, { left: '0%', width: `${topPct * 100}%`, backgroundColor: '#2563eb' }]} />
      <View style={[styles.zone, { left: `${fullPct * 100}%`, right: 0, backgroundColor: '#16a34a' }]} />
      <View style={[styles.marker, { left: `${pct * 100}%` }]} />
    </View>
  );
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
