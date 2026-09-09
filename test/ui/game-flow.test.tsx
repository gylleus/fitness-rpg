import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { createTestDb } from '../db';
import { getGameSnapshot, savePushupWorkout } from '../../src/db/game';
import * as gameRepository from '../../src/db/game';
import { heroes } from '../../src/db/schema';
import RootLayout from '../../app/_layout';
import TabLayout from '../../app/(tabs)/_layout';
import Camp from '../../app/(tabs)/index';
import Dungeon from '../../app/(tabs)/dungeon';
import Forge from '../../app/(tabs)/forge';
import Progress from '../../app/(tabs)/progress';
import Activity from '../../app/activity';
import Session from '../../app/session';
import Health from '../../app/health';
import Run from '../../app/run';

// The connection uses real migrated SQLite. Camera input is supplied at the
// hardware boundary; screens, navigation, save handlers, and game rules are real.
let mockDb: ReturnType<typeof createTestDb>;
jest.mock('../../src/db/client', () => ({
  get db() { return mockDb; },
  useDatabaseMigrations: () => ({ success: true }),
}));

jest.mock('../../src/running/tracker', () => ({
  recoverRun: async () => {}, startRun: async () => { throw new Error('Location permission is required.'); },
  pauseRun: async () => {}, resumeRun: async () => {}, finishRun: async () => {}, discardRun: async () => {},
}));
jest.mock('../../src/ui/RoutePreview', () => ({ RoutePreview: () => null }));
const mockNativeSteps = jest.fn(async () => 6000);
jest.mock('../../src/health/native', () => ({
  healthName: 'Test Health', healthAvailable: async () => true, healthAuthorized: async () => true,
  authorizeHealth: async () => true, readHealthSteps: (...args: []) => mockNativeSteps(...args), openHealthSettings: async () => {},
}));
let mockCameraPermission = true;
const mockRequestPermission = jest.fn(async () => false);
const mockReadout = { value: {
  reps: 0, partials: 0, phase: 'top', d: 0, depthD: 1, maxDThisRep: 0,
  headScore: 1, tracking: true, lastRejection: null, inPosition: true,
  calibrating: false, calProgress: 1, lastRepValid: true, lastRepDepth: 1,
} };
const mockAdjustment = { value: 0 };
const mockPose = { value: {
  keypoints: [], frameIntervalMs: 33, inferenceMs: 10, frameWidth: 720,
  frameHeight: 1280, orientation: 'up',
} };
jest.mock('react-native-vision-camera', () => ({
  Camera: () => null,
  useCameraDevice: () => ({ id: 'test-front-camera' }),
  useCameraPermission: () => ({ hasPermission: mockCameraPermission, requestPermission: mockRequestPermission }),
  usePreviewOutput: () => ({}),
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('../../src/ui/SkeletonOverlay', () => ({ SkeletonOverlay: () => null }));
jest.mock('../../src/pose/usePoseCamera', () => ({
  usePoseCamera: () => ({
    frameOutput: {}, pose: mockPose, readout: mockReadout, manualAdjustment: mockAdjustment,
    resetReps: () => {}, adjustReps: (delta: number) => { mockAdjustment.value += delta; },
    modelState: 'loaded', modelError: null,
  }),
}));
jest.mock('react-native-reanimated/mock', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    default: { call: () => {} },
    runOnJS: (callback: unknown) => callback,
    useAnimatedReaction: (prepare: () => number, react: (value: number, previous: null) => void) => {
      React.useEffect(() => { react(prepare(), null); });
    },
  };
});
jest.mock('react-native-reanimated', () => jest.requireMock('react-native-reanimated/mock'));

const NOW = new Date(2026, 8, 6, 12).getTime();
const appStateListeners = new Set<(state: AppStateStatus) => void>();
const routes = {
  _layout: RootLayout,
  '(tabs)/_layout': TabLayout,
  '(tabs)/index': Camp,
  '(tabs)/dungeon': Dungeon,
  '(tabs)/forge': Forge,
  '(tabs)/progress': Progress,
  activity: Activity,
  session: Session,
  health: Health,
  run: Run,
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockDb = createTestDb();
  mockCameraPermission = true;
  mockNativeSteps.mockReset().mockResolvedValue(6000);
  mockReadout.value.reps = 0;
  mockReadout.value.partials = 0;
  mockAdjustment.value = 0;
  mockRequestPermission.mockClear();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await cleanup();
  mockDb.$client.close();
  appStateListeners.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function press(name: string | RegExp) {
  await fireEvent.press(screen.getByRole('button', { name }));
}

async function moveTime(milliseconds: number) {
  await act(async () => { jest.advanceTimersByTime(milliseconds); });
}

async function navigate(path: '/dungeon' | '/forge' | '/progress' | '/') {
  await act(async () => { router.navigate(path); });
}

describe('first playable game flow', () => {
  it('keeps an active workout mounted when refreshing its save fails', async () => {
    mockReadout.value.reps = 10;
    await renderRouter(routes);
    await press('Train pushups  ·  stockpile attacks');
    jest.spyOn(gameRepository, 'getGameSnapshot').mockImplementationOnce(() => {
      throw new Error('Temporary database read failure');
    });
    await act(async () => { appStateListeners.forEach((listener) => listener('active')); });
    expect(screen.getByText('Finish & save')).toBeVisible();
    expect(screen.getByText('Stats could not refresh.')).toBeVisible();
    await press('Retry refresh');
    expect(screen.queryByText('Stats could not refresh.')).toBeNull();
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('+10 pushups stockpiled')).toBeVisible();
  });

  it('finishes a camera workout with corrections and carries its pushup stockpile back to camp', async () => {
    mockReadout.value.reps = 20;
    mockReadout.value.partials = 3;
    mockAdjustment.value = 2;
    await renderRouter(routes);
    await press('Train pushups  ·  stockpile attacks');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('A little stronger.')).toBeVisible();
    expect(screen.getByText('+22 pushups stockpiled')).toBeVisible();
    expect(getGameSnapshot(mockDb).today).toMatchObject({ pushups: 22, partialReps: 3 });
    await press('Return to camp');
    expect(screen.getByText('+22 added to stockpile')).toBeVisible();
  });

  it('can return to camp when camera permission is denied without saving a workout', async () => {
    mockCameraPermission = false;
    await renderRouter(routes);
    await press('Train pushups  ·  stockpile attacks');
    expect(screen.getByText('Camera permission is required to count reps.')).toBeVisible();
    await press('Back to camp');
    expect(screen.getByText('Welcome to camp.')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(0);
  });

  it('retains the camera count after a failed save and allows a successful retry', async () => {
    mockReadout.value.reps = 12;
    mockDb.run("CREATE TRIGGER fail_workout BEFORE INSERT ON sets BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    await renderRouter(routes);
    await press('Train pushups  ·  stockpile attacks');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(Alert.alert).toHaveBeenCalledWith('Could not save', expect.any(String));
    expect(screen.getByText('Finish & save')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(0);
    mockDb.run('DROP TRIGGER fail_workout');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('+12 pushups stockpiled')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(12);
  });

  it('offers to save an unfinished workout when using back navigation', async () => {
    mockReadout.value.reps = 10;
    await renderRouter(routes);
    await press('Train pushups  ·  stockpile attacks');
    await act(async () => { router.back(); });
    expect(Alert.alert).toHaveBeenCalledWith('Save your pushups?', expect.any(String), expect.any(Array));
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    await act(async () => { buttons?.find((button) => button.text === 'Save workout')?.onPress?.(); });
    expect(screen.getByText('+10 pushups stockpiled')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(10);
  });

  it('connects native steps and refreshes power without a manual entry form', async () => {
    await renderRouter(routes);
    await press('Connect steps');
    await press('Connect Test Health');
    expect(getGameSnapshot(mockDb).today.steps).toBe(6000);
    expect(screen.getByRole('button', { name: 'Sync steps now' })).toBeVisible();
    await press('← Camp');
    expect(screen.getByText('6,000')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Update steps' })).toBeNull();
  });

  it('shows a denied GPS permission without creating an empty workout', async () => {
    await renderRouter(routes);
    await press('Start running');
    await press('Start running');
    expect(screen.getByText('Location permission is required.')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.runs).toBe(0);
  });

  it('claims earned quests once and buys a permanent upgrade through the forge', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'earned-pushups', startedAt: NOW - 60_000, endedAt: NOW, validReps: 20, partialReps: 2 });
    await renderRouter(routes);
    await press('Claim gold');
    expect(screen.getByRole('button', { name: 'Claimed ✓' })).toBeDisabled();
    await press('Connect steps');
    await press('Connect Test Health');
    await press('← Camp');
    await press('Claim gold');
    await navigate('/forge');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Upgrade  ·  ◆ 30 gold' })[0]);
    expect(getGameSnapshot(mockDb).hero).toMatchObject({ gold: 10, swordLevel: 1 });
    expect(screen.getByText('Equipped · upgrade 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Need 45 more gold  ·  ◆ 55' })).toBeDisabled();
  });

  it('pauses combat when navigating away or backgrounding and resumes saved turns', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'entry-reserve', startedAt: NOW - 60_000, endedAt: NOW, validReps: 100, partialReps: 0 });
    gameRepository.saveStepTotal(mockDb, '2026-09-06', 6000);
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    await moveTime(800);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(1);
    await navigate('/');
    await moveTime(5000);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(1);
    await navigate('/dungeon');
    await moveTime(800);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(2);
    await act(async () => { appStateListeners.forEach((listener) => listener('background')); });
    await moveTime(5000);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(2);
    await act(async () => { appStateListeners.forEach((listener) => listener('active')); });
    await moveTime(800);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(3);
    await press('Pause battle');
    await moveTime(5000);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(3);
  });

  it('shows boss victory, retains rewards, and enables the next dungeon', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'boss-training', startedAt: NOW - 60_000, endedAt: NOW, validReps: 100, partialReps: 0 });
    savePushupWorkout(mockDb, { sourceKey: 'entry-reserve', startedAt: NOW - 60_000, endedAt: NOW, validReps: 100, partialReps: 0 });
    gameRepository.saveStepTotal(mockDb, '2026-09-06', 6000);
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    for (let tick = 0; tick < 40; tick++) await moveTime(800);
    expect(screen.getByText('Boss defeated. A new path opens.')).toBeVisible();
    expect(getGameSnapshot(mockDb).hero).toMatchObject({ gold: 70, xp: 85, unlockedDungeon: 1 });
    expect(screen.getAllByRole('button', { name: 'Enter dungeon  →' })).toHaveLength(2);
  });

  it('shows depletion, refunds pushups, and allows retrying', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'two-attacks', startedAt: NOW - 60_000, endedAt: NOW, validReps: 2, partialReps: 0 });
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    for (let tick = 0; tick < 12; tick++) await moveTime(800);
    expect(screen.getByText('Your stockpile ran out. No gold or XP earned. Your pushups and entry health are restored; train more or improve your gear to get further.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try this dungeon again' })).toBeEnabled();
    expect(getGameSnapshot(mockDb)).toMatchObject({ pushupUnits: 200, hero: { gold: 0, xp: 0 }, today: { pushups: 2 } });
    await press('Try this dungeon again');
    expect(getGameSnapshot(mockDb).latestBattle?.state.pushupUnits).toBe(200);
  });

  it('buys the rare amulet and drinks a focus potion through the forge', async () => {
    gameRepository.getHero(mockDb);
    mockDb.update(heroes).set({ gold: 200, unlockedDungeon: 1 }).run();
    savePushupWorkout(mockDb, { sourceKey: 'reserve', startedAt: NOW - 60_000, endedAt: NOW, validReps: 9, partialReps: 0 });
    await renderRouter(routes, { initialUrl: '/forge' });
    await press('Buy amulet  ·  ◆ 150 gold');
    expect(screen.getByRole('button', { name: 'Amulet equipped ✓' })).toBeDisabled();
    await press('Buy focus potion  ·  ◆ 25 gold');
    await press('Drink focus potion');
    expect(screen.getByRole('button', { name: 'Drink focus potion' })).toBeDisabled();
    expect(getGameSnapshot(mockDb)).toMatchObject({ attackCostUnits: 70, attacksAvailable: 12,
      hero: { gold: 25, amuletOwned: true, focusPotions: 0, focusAttacks: 10 } });
    await navigate('/');
    expect(screen.getByText(/12 attacks available/)).toBeVisible();
  });

  it('refreshes midnight bonuses in a mounted app without deleting yesterday', async () => {
    const late = new Date(2026, 8, 6, 23, 59, 59).getTime();
    jest.setSystemTime(late);
    savePushupWorkout(mockDb, { sourceKey: 'late-training', startedAt: late - 60_000, endedAt: late, validReps: 20, partialReps: 0 });
    await renderRouter(routes);
    expect(screen.getByText('+20 added to stockpile')).toBeVisible();
    await moveTime(1100);
    expect(screen.queryByText('+20 added to stockpile')).toBeNull();
    const snapshot = getGameSnapshot(mockDb);
    expect(snapshot.today.pushups).toBe(0);
    expect(snapshot.pushupUnits).toBe(2000);
    expect(screen.getByText(/20 attacks available/)).toBeVisible();
    expect(snapshot.history.find((day) => day.day === '2026-09-06')?.pushups).toBe(20);
  });
});
