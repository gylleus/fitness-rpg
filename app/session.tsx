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

import { usePoseCamera } from '../src/pose/usePoseCamera';
import { SkeletonOverlay } from '../src/ui/SkeletonOverlay';
import type { InputRotation } from '../src/pose/model';

const ROTATIONS: InputRotation[] = [0, 90, 180, 270];

export default function Session() {
  const router = useRouter();
  useKeepAwake();

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // The accuracy spike: MoveNet is trained on upright people, and a pushup is
  // horizontal. This cycles the input rotation so the effect can be seen live.
  const [rotationIndex, setRotationIndex] = useState(0);
  const rotation = ROTATIONS[rotationIndex];

  const { frameOutput, pose, modelState, modelError } = usePoseCamera({ rotation });
  const previewOutput = usePreviewOutput();

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  // Sample the shared value at ~5Hz for the debug readout instead of on every
  // frame — the numbers are unreadable faster than that anyway.
  const [debug, setDebug] = useState({ ms: 0, tracked: 0, best: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const snap = pose.value;
      const scores = snap.keypoints.map((k) => k.score);
      setDebug({
        ms: Math.round(snap.inferenceMs),
        tracked: scores.filter((s) => s >= 0.3).length,
        best: Math.round(Math.max(0, ...scores) * 100),
      });
    }, 200);
    return () => clearInterval(id);
  }, [pose]);

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
        <Text style={styles.notice}>No back camera found on this device.</Text>
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
      />
      <SkeletonOverlay pose={pose} />

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.debugPanel}>
          <Text style={styles.debugText}>model: {modelState}</Text>
          <Text style={styles.debugText}>inference: {debug.ms} ms</Text>
          <Text style={styles.debugText}>joints tracked: {debug.tracked}/17</Text>
          <Text style={styles.debugText}>best score: {debug.best}%</Text>
          {modelError ? <Text style={styles.errorText}>{String(modelError)}</Text> : null}
        </View>

        <View style={styles.controls}>
          <Pressable
            style={styles.button}
            onPress={() => setRotationIndex((i) => (i + 1) % ROTATIONS.length)}
          >
            <Text style={styles.buttonText}>rotate input: {rotation}°</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Finish</Text>
          </Pressable>
        </View>
      </View>
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
  controls: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10 },
  secondary: { backgroundColor: '#374151' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
