import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { AppState } from 'react-native';
import { createTestDb } from '../db';
import { activeRecording, appendLocations, createRecording, getRoute } from '../../src/db/recordings';
import { discardRun, recoverRun } from '../../src/running/tracker';
import { getGameSnapshot } from '../../src/db/game';
import Root from '../../app/_layout';
import Tabs from '../../app/(tabs)/_layout';
import Camp from '../../app/(tabs)/index';
import Run from '../../app/run';
import Health from '../../app/health';

let mockDb: ReturnType<typeof createTestDb>;
let mockTask: (event: unknown) => Promise<void>;
let mockSteps: ((event: { steps: number }) => void) | null;
let mockRegistered = false;
let mockPrecise = true;
let mockBackgroundGranted = true;
const mockStart = jest.fn(async () => { mockRegistered = true; });
const mockStop = jest.fn(async () => { mockRegistered = false; });
jest.mock('../../src/db/client', () => ({ get db() { return mockDb; }, useDatabaseMigrations: () => ({ success: true }), ensureDatabaseReady: async () => {} }));
jest.mock('expo-task-manager', () => ({ defineTask: (_name: string, task: typeof mockTask) => { mockTask = task; } }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 }, ActivityType: { Fitness: 3 },
  hasServicesEnabledAsync: async () => true,
  requestForegroundPermissionsAsync: async () => ({ granted: true, android: { accuracy: mockPrecise ? 'fine' : 'coarse' } }),
  requestBackgroundPermissionsAsync: async () => ({ granted: mockBackgroundGranted }),
  hasStartedLocationUpdatesAsync: async () => mockRegistered,
  startLocationUpdatesAsync: (...args: []) => mockStart(...args),
  stopLocationUpdatesAsync: (...args: []) => mockStop(...args),
}));
jest.mock('expo-sensors', () => ({ Pedometer: {
  getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => ({ granted: true }), isAvailableAsync: async () => true,
  watchStepCount: (callback: typeof mockSteps) => { mockSteps = callback; return { remove: () => { mockSteps = null; } }; },
} }));
jest.mock('../../src/health/native', () => ({ healthName: 'Test Health', healthAvailable: async () => true, healthAuthorized: async () => true, authorizeHealth: async () => true, readHealthSteps: async () => 0 }));
const now = new Date(2026, 8, 6, 12).getTime();
const routes = { _layout: Root, '(tabs)/_layout': Tabs, '(tabs)/index': Camp, run: Run, health: Health, session: () => null, activity: () => null };

beforeEach(() => { mockDb = createTestDb(); jest.useFakeTimers(); jest.setSystemTime(now); AppState.currentState = 'active'; mockRegistered = false; mockPrecise = true; mockBackgroundGranted = true; mockSteps = null; mockStart.mockClear(); mockStop.mockClear(); });
afterEach(async () => { await cleanup(); mockDb.$client.close(); jest.useRealTimers(); });
async function press(name: string) { await fireEvent.press(screen.getByRole('button', { name })); }
function point(second: number, meters: number) { return { timestamp: now + second * 1000, mocked: false, coords: { latitude: 0, longitude: meters / 111195, accuracy: 5, altitude: 1 } }; }

it('records real screen actions, persists GPS, pauses sensors, resumes and saves one workout', async () => {
  await renderRouter(routes, { initialUrl: '/run' });
  await press('Start running');
  expect(mockStart).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ foregroundService: expect.any(Object) }));
  const id = activeRecording(mockDb)!.id;
  jest.setSystemTime(now + 20000);
  await act(async () => {
    await mockTask({ data: { locations: [point(0, 0), point(10, 20), point(20, 40)] } });
    mockSteps?.({ steps: 50 });
  });
  await press('Pause run');
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(activeRecording(mockDb)?.status).toBe('paused');
  jest.setSystemTime(now + 40000);
  await act(async () => { await mockTask({ data: { locations: [point(30, 200)] } }); });
  expect(getRoute(mockDb, id)).toHaveLength(3);
  await press('Resume run');
  expect(mockStart).toHaveBeenCalledTimes(2);
  jest.setSystemTime(now + 60000);
  await act(async () => {
    await mockTask({ data: { locations: [point(40, 100), point(50, 120), point(60, 140)] } });
    mockSteps?.({ steps: 40 });
  });
  await press('Finish & save run');
  expect(screen.getByText('Run saved.')).toBeVisible();
  expect(mockStop).toHaveBeenCalledTimes(2);
  const snapshot = getGameSnapshot(mockDb);
  expect(snapshot.totals.runs).toBe(1);
  expect(snapshot.today.durationSeconds).toBe(40);
  expect(snapshot.today.distanceMeters).toBeCloseTo(80, 1);
  expect(snapshot.today.runningSteps).toBe(90);
  expect(activeRecording(mockDb)).toBeNull();
});

it('keeps an ongoing run active after a stationary screen-lock interval', async () => {
  await renderRouter(routes, { initialUrl: '/run' });
  await press('Start running');
  jest.setSystemTime(now + 300000);
  await act(async () => { await recoverRun(); });
  expect(activeRecording(mockDb)?.status).toBe('recording');
  await act(async () => { await discardRun(activeRecording(mockDb)!.id); });
});

it('restores an interrupted run paused at its last fix instead of counting closed-app time', async () => {
  createRecording(mockDb, 'interrupted', now);
  appendLocations(mockDb, 'interrupted', [point(0, 0), point(20, 40)].map(p => ({ ...p.coords, timestamp: p.timestamp })), now + 20000);
  jest.setSystemTime(now + 300000);
  await renderRouter(routes, { initialUrl: '/run' });
  expect(activeRecording(mockDb)).toMatchObject({ status: 'paused', segments: [{ start: now, end: now + 20000 }] });
  expect(screen.getByText('Take a breath.')).toBeVisible();
  await act(async () => { await discardRun('interrupted'); });
});

it('explains approximate location instead of starting a run that cannot measure distance', async () => {
  mockPrecise = false;
  await renderRouter(routes, { initialUrl: '/run' });
  await press('Start running');
  expect(screen.getByText(/Precise location is needed/)).toBeVisible();
  expect(activeRecording(mockDb)).toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
});

it('requires screen-lock location access before starting the background recorder', async () => {
  mockBackgroundGranted = false;
  await renderRouter(routes, { initialUrl: '/run' });
  await press('Start running');
  expect(screen.getByText(/so your run keeps recording when the screen locks/)).toBeVisible();
  expect(activeRecording(mockDb)).toBeNull();
  expect(mockStart).not.toHaveBeenCalled();
});
