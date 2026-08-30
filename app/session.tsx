import { useEffect, useState } from 'react';
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

  const { frameOutput, pose, readout, resetReps, modelState, modelError } = usePoseCamera({
    rotation,
  });
  const previewOutput = usePreviewOutput();

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Sample shared values at ~10Hz rather than reacting per frame: the numbers
  // are unreadable faster than that, and it keeps 30fps of keypoints off the JS
  // thread entirely.
  const [debug, setDebug] = useState({ ms: 0, tracked: 0, best: 0 });
  const [reps, setReps] = useState({
    reps: 0,
    partials: 0,
    phase: 'unknown' as string,
    angle: NaN,
    depth: NaN,
    tracking: false,
    rejection: null as string | null,
    inPosition: false,
    tilt: NaN,
  });

  useEffect(() => {
    const id = setInterval(() => {
      const snap = pose.value;
      const scores = snap.keypoints.map((k) => k.score);
      setDebug({
        ms: Math.round(snap.inferenceMs),
        tracked: scores.filter((s) => s >= 0.3).length,
        best: Math.round(Math.max(0, ...scores) * 100),
      });

      const r = readout.value;
      setReps({
        reps: r.reps,
        partials: r.partials,
        phase: r.phase,
        angle: r.elbowAngle,
        depth: r.dipMinAngle,
        tracking: r.tracking,
        rejection: r.lastRejection,
        inPosition: r.inPosition,
        tilt: r.torsoTilt,
      });
    }, 100);
    return () => clearInterval(id);
  }, [pose, readout]);

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
            torso tilt: {Number.isNaN(reps.tilt) ? '--' : Math.round(reps.tilt) + '°'}
            {'  '}(max {DEFAULT_CONFIG.maxTorsoTiltDeg}°)
          </Text>
          <Text style={styles.debugText}>
            elbow: {Number.isNaN(reps.angle) ? '--' : Math.round(reps.angle)}°
          </Text>
          <Text style={styles.debugText}>
            deepest: {Number.isFinite(reps.depth) ? Math.round(reps.depth) + '°' : '--'}
          </Text>
          {reps.rejection ? (
            <Text style={styles.warnText}>last movement rejected: {reps.rejection}</Text>
          ) : null}
          <Text style={styles.debugText}>model: {modelState}</Text>
          <Text style={styles.debugText}>inference: {debug.ms} ms</Text>
          <Text style={styles.debugText}>joints tracked: {debug.tracked}/17</Text>
          <Text style={styles.debugText}>best score: {debug.best}%</Text>
          <Text style={styles.debugText}>camera: {position}</Text>
          {modelError ? <Text style={styles.errorText}>{String(modelError)}</Text> : null}
        </View>

        <View style={styles.counterWrap} pointerEvents="none">
          {!reps.inPosition ? (
            <Text style={styles.prompt}>Get into pushup position</Text>
          ) : null}
          <Text style={styles.counter}>{reps.reps}</Text>
          <Text style={styles.counterLabel}>
            reps{reps.partials > 0 ? `   ·   ${reps.partials} partial` : ''}
          </Text>
          <AngleBar angle={reps.angle} />
        </View>

        <View style={styles.controls}>
          <Pressable style={[styles.button, styles.secondary]} onPress={resetReps}>
            <Text style={styles.buttonText}>reset</Text>
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
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
