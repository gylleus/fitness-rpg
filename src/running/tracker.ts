import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Pedometer } from 'expo-sensors';
import { eq } from 'drizzle-orm';
import { db, ensureDatabaseReady } from '../db/client';
import { activeRecording, addObservedSteps, appendLocations, createRecording, discardRecording, finishRecording, getRecording, pauseRecording, resumeRecording } from '../db/recordings';
import { runRecordings } from '../db/schema';
import { getHealthConnection, stepsInSegments } from '../health/sync';

const TASK = 'fitness-rpg-gps-run';
let pedometer: { remove(): void } | null = null;
let operation: Promise<unknown> | null = null;
let ownsActiveSensors = false;

// Task definitions must be at module scope: Android/iOS may launch a headless
// runtime without rendering any screen to deliver background GPS batches.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  await ensureDatabaseReady();
  const recording = activeRecording(db);
  if (!recording || recording.status !== 'recording') return;
  if (error) {
    db.update(runRecordings).set({ error: 'GPS tracking was interrupted. Check location permission and resume your run.' }).where(eq(runRecordings.id, recording.id)).run();
    return;
  }
  if (data?.locations) appendLocations(db, recording.id, data.locations.filter(p => !p.mocked).map(p => ({
    timestamp: p.timestamp, latitude: p.coords.latitude, longitude: p.coords.longitude,
    accuracy: p.coords.accuracy ?? Infinity, altitude: p.coords.altitude,
  })));
});

async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (operation) throw new Error('The previous run action is still finishing. Please try again.');
  const pending = action();
  operation = pending;
  try { return await pending; } finally { operation = null; }
}
function stopSteps() { pedometer?.remove(); pedometer = null; }
async function watchSteps(id: string) {
  stopSteps();
  try {
    if (!(await Pedometer.getPermissionsAsync()).granted || !await Pedometer.isAvailableAsync()) return;
    let last = 0;
    pedometer = Pedometer.watchStepCount(({ steps }) => {
      const delta = Math.max(0, steps - last);
      last = steps;
      addObservedSteps(db, id, delta);
    });
  } catch { /* GPS remains usable; health sync supplies steps independently. */ }
}
async function startSensors(id: string) {
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 3, timeInterval: 2000, deferredUpdatesInterval: 2000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'Fitness RPG · run in progress', notificationBody: 'Recording your route. Open Fitness RPG to pause or finish.', killServiceOnDestroy: false },
  });
  ownsActiveSensors = true;
  await watchSteps(id);
}
async function stopSensors() {
  stopSteps();
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  ownsActiveSensors = false;
}
export async function requestRunPermissions() {
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on your phone’s location services to record a run.');
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('Allow precise location access to record your route. You can change this in phone settings.');
  if (foreground.android?.accuracy === 'coarse' || foreground.ios?.accuracy === 'reduced') {
    throw new Error('Precise location is needed to measure a run. Enable precise location for Fitness RPG in phone settings.');
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error('Allow location access “all the time” so your run keeps recording when the screen locks.');
  // Optional: declining motion access does not block GPS recording.
  await Pedometer.requestPermissionsAsync().catch(() => undefined);
}
export const startRun = () => exclusive(async () => {
  const existing = activeRecording(db);
  if (existing) return existing;
  await requestRunPermissions();
  const row = createRecording(db, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try { await startSensors(row.id); }
  catch (error) { pauseRecording(db, row.id, Date.now(), 'Location tracking could not start. Try resuming.'); throw error; }
  return row;
});
export const pauseRun = (id: string) => exclusive(async () => {
  // Persist pause first; late GPS batches and sensor events cannot add distance.
  pauseRecording(db, id);
  await stopSensors();
});
export const resumeRun = (id: string) => exclusive(async () => {
  await requestRunPermissions();
  resumeRecording(db, id);
  try { await startSensors(id); }
  catch (error) { pauseRecording(db, id, Date.now(), 'Location tracking could not resume. Please try again.'); throw error; }
});
export const finishRun = (id: string) => exclusive(async () => {
  pauseRecording(db, id);
  await stopSensors();
  const row = getRecording(db, id);
  if (!row) throw new Error('Run not found.');
  // Step import may lag behind GPS or be unavailable. Save the route now and
  // reconcile health steps during the next sync, without requiring manual input.
  let steps: number | null = null;
  if (getHealthConnection(db)?.enabled) {
    try { steps = await stepsInSegments(row.segments); } catch { /* retry on health sync */ }
  }
  return finishRecording(db, id, steps);
});
export const discardRun = (id: string) => exclusive(async () => {
  discardRecording(db, id);
  await stopSensors();
});
export async function recoverRun() {
  const row = activeRecording(db);
  if (!row || row.status !== 'recording') return;
  const last = row.lastFixAt ?? row.segments[row.segments.length - 1].start;
  const registered = await Location.hasStartedLocationUpdatesAsync(TASK);
  if (!registered || (!ownsActiveSensors && Date.now() - last > 180_000)) {
    pauseRecording(db, row.id, last, 'The previous recording was interrupted. Your route is saved. Resume when ready.');
    await stopSensors();
  } else {
    ownsActiveSensors = true;
    if (!pedometer) await watchSteps(row.id);
  }
}
