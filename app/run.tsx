import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, Text, View } from 'react-native';
import { db } from '../src/db/client';
import { activeRecording, getRecording, getRoute } from '../src/db/recordings';
import { useGame } from '../src/game/GameProvider';
import { paceLabel, runDodgeBps } from '../src/game/rules';
import { percentLabel } from '../src/game/items';
import { activeMilliseconds } from '../src/running/route';
import { discardRun, finishRun, pauseRun, recoverRun, resumeRun, startRun } from '../src/running/tracker';
import { RoutePreview } from '../src/ui/RoutePreview';
import { Button, Card, colors, PageHeading, Screen, ui } from '../src/ui/theme';

export default function RunScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { refresh, foreground } = useGame();
  const [selectedId, setSelectedId] = useState(id);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recording = selectedId ? getRecording(db, selectedId) : activeRecording(db);
  const points = recording ? getRoute(db, recording.id) : [];
  const finished = recording?.status === 'finished';
  const active = recording?.status === 'recording';
  const seconds = recording ? activeMilliseconds(recording.segments, now) / 1000 : 0;
  const distance = recording?.distanceMeters ?? 0;
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update your run. Please try again.'); }
    finally { setBusy(false); setNow(Date.now()); }
  };
  useEffect(() => {
    if (!foreground) return;
    void recoverRun().then(() => { refresh(); setNow(Date.now()); }).catch(() => setError('Could not check the GPS service. Your saved route is safe.'));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [foreground, refresh]);
  return <Screen>
    <Button compact secondary label="← Camp" onPress={() => router.replace('/')} />
    <PageHeading eyebrow="Training / GPS run" title={finished ? 'Run saved.' : active ? 'Find your stride.' : recording ? 'Take a breath.' : 'Ready to run?'} />
    <Card>
      <View style={ui.between}><Text style={ui.label}>{finished ? 'Completed run' : active ? '● Recording' : recording ? 'Ⅱ Paused' : 'Outdoor run'}</Text><Text style={{ color: colors.green }}>{(distance / 1000).toFixed(2)} km</Text></View>
      <Text style={ui.number}>{String(Math.floor(seconds / 3600)).padStart(2, '0')}:{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:{String(Math.floor(seconds) % 60).padStart(2, '0')}</Text>
      <Text style={ui.small}>Active time · pauses excluded</Text>
      <View style={ui.between}><Text style={ui.body}>{paceLabel(distance, seconds)} /km</Text><Text style={ui.body}>{seconds ? (distance / seconds * 3.6).toFixed(1) : '0.0'} km/h avg</Text></View>
      <RoutePreview points={points} />
      {active && <Text style={[ui.small, { color: recording.lastFixAt && now - recording.lastFixAt < 30_000 ? colors.green : colors.gold }]}>{!recording.lastFixAt ? 'Waiting for a clear GPS signal. Move outdoors.' : now - recording.lastFixAt > 30_000 ? 'GPS signal is weak or you are stationary. Distance updates when reliable movement is detected.' : 'GPS recording · screen may be locked'}</Text>}
      {(error || recording?.error) && <Text accessibilityRole="alert" style={{ color: colors.red }}>{error ?? recording?.error}</Text>}
      {!recording ? <>
        <Text style={ui.body}>Record your route, pace, and distance. Pausing stops GPS and the clock; finishing saves your run and earns daily dodge from distance and pace.</Text>
        <Text style={ui.small}>Allow precise location and “all the time” access when prompted so recording continues with the screen locked. Your route stays on this phone.</Text>
        <Button label={busy ? 'Starting…' : 'Start running'} disabled={busy} onPress={() => { void act(async () => { const row = await startRun(); setSelectedId(row.id); }); }} />
      </> : finished ? <>
        <Text style={[ui.heading, { color: colors.green }]}>+{percentLabel(runDodgeBps({ distanceMeters: distance, durationSeconds: seconds }))} dodge contribution</Text>
        <Text style={ui.small}>Your GPS route is saved. Running dodge totals up to 30% on the completion day. Step counts refresh from your phone’s health app as it syncs; no manual entry is needed.</Text>
        <Button label="View fitness progress" onPress={() => router.replace('/progress')} />
      </> : <>
        <Button label={busy ? 'Updating…' : active ? 'Pause run' : 'Resume run'} disabled={busy} onPress={() => { void act(() => active ? pauseRun(recording.id) : resumeRun(recording.id)); }} />
        <Button secondary label="Finish & save run" disabled={busy} onPress={() => { void act(async () => { await finishRun(recording.id); setSelectedId(recording.id); }); }} />
        <Button compact secondary label="Discard run" disabled={busy} onPress={() => Alert.alert('Discard this run?', 'Its recorded route will be deleted and no workout will be saved.', [{ text: 'Keep run', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { void act(async () => { await discardRun(recording.id); setSelectedId(undefined); }); } }])} />
        <Text style={ui.small}>You can leave this screen while recording. Pause or finish to stop GPS. Force-closing the app may interrupt tracking; your saved route can be resumed.</Text>
      </>}
      {error && <Button compact secondary label="Open phone settings" onPress={() => { void Linking.openSettings(); }} />}
    </Card>
  </Screen>;
}
