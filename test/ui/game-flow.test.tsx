import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { giveItem } from '../equipment';
import { GEAR } from '../../src/game/equipment';
import { DUNGEONS } from '../../src/game/combat';
import { createTestDb } from '../db';
import { getGameSnapshot, savePushupWorkout } from '../../src/db/game';
import { createRecording } from '../../src/db/recordings';
import * as gameRepository from '../../src/db/game';
import { dungeonRuns, heroes } from '../../src/db/schema';
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
import Expedition from '../../app/expedition';

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
    ...require('../shared-value-mock'),
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
  expedition: Expedition,
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
  it('confirms a development reset, refreshes camp, and keeps step sync disconnected after remount', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'dev-training', startedAt: NOW - 60_000, endedAt: NOW, validReps: 20, partialReps: 2 });
    await renderRouter(routes);
    await press('Connect steps');
    await press('Connect Test Health');
    await press('← Camp');
    const before = getGameSnapshot(mockDb);
    await press('Reset data');
    expect(Alert.alert).toHaveBeenCalledWith('Reset today’s data?', expect.any(String), expect.any(Array));
    expect(getGameSnapshot(mockDb)).toEqual(before);
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    expect(buttons).toContainEqual({ text: 'Cancel', style: 'cancel' });
    await act(async () => { buttons?.find(button => button.text === 'Reset data')?.onPress?.(); });
    expect(screen.getByText('+0 saved today')).toBeVisible();
    expect(screen.queryByText('6,000')).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect steps' })).toBeVisible();
    expect(getGameSnapshot(mockDb)).toMatchObject({ today: { pushups: 0, steps: 0 }, stats: { damageMultiplier: 1 } });
    mockNativeSteps.mockClear();
    await moveTime(60_000);
    await cleanup();
    await renderRouter(routes);
    expect(screen.getByRole('button', { name: 'Connect steps' })).toBeVisible();
    expect(mockNativeSteps).not.toHaveBeenCalled();
    expect(getGameSnapshot(mockDb).today.steps).toBe(0);
  });

  it('disables the development reset while a GPS run is unfinished', async () => {
    createRecording(mockDb, 'active-dev-run', NOW);
    await renderRouter(routes);
    expect(screen.getByRole('button', { name: 'Reset data' })).toBeDisabled();
    expect(screen.getByText('Finish or discard your current run to reset daily data.')).toBeVisible();
  });

  it('hides development reset controls in production', async () => {
    jest.replaceProperty(global as typeof global & { __DEV__: boolean }, '__DEV__', false);
    await renderRouter(routes);
    expect(screen.queryByRole('button', { name: 'Reset data' })).toBeNull();
    expect(screen.queryByText('Development tools')).toBeNull();
  });

  it('updates the camp knight after equipping a sword and returns to fists when unequipped', async () => {
    const sword = Object.values(GEAR).find(item => item.weaponType === 'sword')!;
    giveItem(mockDb, sword);
    await renderRouter(routes, { initialUrl: '/' });
    expect(screen.getByTestId('entity-sprite-barbarian_player')).toBeTruthy();
    await navigate('/forge');
    await press(`Inspect ${sword.name}`);
    await press('Equip to Weapon');
    await press('Close item');
    await navigate('/');
    expect(screen.getByTestId('entity-sprite-knight_player_sword')).toBeTruthy();
    await navigate('/forge');
    await press(`Weapon: ${sword.name}`);
    await press('Unequip to bag');
    await press('Close item');
    await navigate('/');
    expect(screen.getByTestId('entity-sprite-knight_player_fist')).toBeTruthy();
  });

  it('lets players inspect locked map destinations without starting or unlocking them', async () => {
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByTestId('dungeon-map')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(DUNGEONS.length);
    expect(screen.getByRole('button', { name: 'Select Wetlands, selected' })).toBeSelected();
    await press('Select Embercrypt, locked');
    expect(screen.getByRole('button', { name: 'Select Embercrypt, locked' })).toBeSelected();
    expect(screen.getByText('Defeat Root Hulk in Wetlands to open this path.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Defeat Root Hulk' })).toBeDisabled();
    expect(getGameSnapshot(mockDb).latestBattle).toBeNull();
    expect(getGameSnapshot(mockDb).hero.unlockedDungeon).toBe(0);
    await press('Select Wetlands, available');
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
  });

  it.each(DUNGEONS)('enters the selected $name map destination', async dungeon => {
    gameRepository.getHero(mockDb);
    mockDb.update(heroes).set({ unlockedDungeon: 3 }).run();
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press(new RegExp(`^Select ${dungeon.name},`));
    expect(screen.getByTestId(`map-location-${dungeon.id}`)).toBeSelected();
    await press('Enter dungeon  →');
    expect(getGameSnapshot(mockDb).latestBattle?.state.dungeonId).toBe(dungeon.id);
    expect(screen.getByTestId('fullscreen-expedition')).toBeVisible();
  });

  it('allows map browsing during an active run while preventing a second expedition', async () => {
    gameRepository.getHero(mockDb);
    mockDb.update(heroes).set({ unlockedDungeon: 3 }).run();
    const active = gameRepository.startDungeon(mockDb, 0, NOW);
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByRole('button', { name: 'Select Wetlands, in progress' })).toBeSelected();
    await press('Select Hollow Delve, available');
    expect(screen.getByRole('button', { name: 'Expedition in progress' })).toBeDisabled();
    await press('Continue expedition');
    expect(getGameSnapshot(mockDb).latestBattle?.id).toBe(active.id);
    expect(mockDb.select().from(dungeonRuns).all()).toHaveLength(1);
  });

  it('equips two found rings independently and locks their controls during combat', async () => {
    giveItem(mockDb, GEAR.copper_ring);
    giveItem(mockDb, GEAR.copper_ring);
    await renderRouter(routes, { initialUrl: '/forge' });
    await fireEvent.press(screen.getAllByRole('button', { name: 'Inspect Heavy Copper Ring' })[0]);
    await press('Equip to Ring 1');
    await press('Close item');
    await press('Inspect Heavy Copper Ring');
    await press('Equip to Ring 2');
    await press('Close item');
    expect(getGameSnapshot(mockDb).inventory.filter(item => item.slot?.startsWith('ring'))).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Ring 1: Heavy Copper Ring' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ring 2: Heavy Copper Ring' })).toBeEnabled();
    await navigate('/dungeon');
    await press('Enter dungeon  →');
    await navigate('/forge');
    await press('Ring 1: Heavy Copper Ring');
    expect(screen.getByRole('button', { name: 'Unequip to bag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Sell for ${GEAR.copper_ring.sellValue} gold` })).toBeDisabled();
  });

  it('shows the actual boss reward and makes the won equipment inspectable in the bag', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'loot-training', startedAt: NOW - 60000, endedAt: NOW, validReps: 100, partialReps: 0 });
    let run = gameRepository.startDungeon(mockDb, 0, NOW);
    for (let i = 0; i < 200 && run.status === 'active'; i++) run = gameRepository.advanceDungeon(mockDb, run.id, run.state.tick, NOW)!;
    expect(run.status).toBe('victory');
    const boss = run.state.loot!.find(drop => drop.boss)!;
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByRole('button', { name: `Preview loot ${boss.item.name}` })).toBeVisible();
    await press(`Preview loot ${boss.item.name}`);
    expect(screen.getByText(boss.item.visualDescription!)).toBeVisible();
    expect(screen.getByText('Secured in your bag. Equip it from Inventory at camp.')).toBeVisible();
    await press('Close item');
    await act(async () => { router.push('/expedition'); });
    await press(`Preview loot ${boss.item.name}`);
    expect(screen.getByText(boss.item.visualDescription!)).toBeVisible();
    await press('Close item');
    await navigate('/forge');
    await press(`Inspect ${boss.item.name}`);
    expect(screen.getByRole('button', { name: `Sell for ${boss.item.sellValue} gold` })).toBeEnabled();
  });

  it('filters, searches and pages a large bag while keeping item inspection available', async () => {
    for (const item of Object.values(GEAR).slice(1, 31)) giveItem(mockDb, item);
    await renderRouter(routes, { initialUrl: '/forge' });
    expect(screen.getAllByRole('button', { name: /^Inspect / })).toHaveLength(24);
    await press('Show more items');
    expect(screen.getAllByRole('button', { name: /^Inspect / })).toHaveLength(30);
    await press('Swords');
    expect(screen.queryByRole('button', { name: 'Inspect Iron-bound Club' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search your bag'), 'ditch');
    expect(screen.getAllByRole('button', { name: /^Inspect / })).toHaveLength(1);
    await press('Inspect Ditch Blade');
    expect(screen.getByTestId('equipment-comparison')).toBeVisible();
    await press('Close item');
    await fireEvent.changeText(screen.getByLabelText('Search your bag'), 'does not exist');
    expect(screen.getByText('No items match this search.')).toBeVisible();
    await fireEvent.changeText(screen.getByLabelText('Search your bag'), '');
    await press('All gear');
    await press('Sort: name');
    expect(screen.getAllByRole('button', { name: /^Inspect / })[0].props.accessibilityLabel).toBe('Inspect Antler-crowned Mace');
  });

  it('previews protection before equipping armor and keeps maximum health separate', async () => {
    giveItem(mockDb, GEAR.hide_armor);
    await renderRouter(routes, { initialUrl: '/forge' });
    await press('Inspect Patched Hide Armor');
    expect(screen.getByText('2 → 12 (+10)')).toBeVisible();
    expect(screen.getByText(GEAR.hide_armor.visualDescription!)).toBeVisible();
    await press('Equip to Armor');
    expect(getGameSnapshot(mockDb).stats).toMatchObject({ armor: 12, health: 100 });
    await press('Close item');
    expect(screen.getByText('12 armor · 10.7% damage reduction')).toBeVisible();
  });

  it('starts the attack on arrival without an idle tick or waiting for the walk loop to finish', async () => {
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    await moveTime(500);
    await moveTime(500);
    expect(getGameSnapshot(mockDb).latestBattle?.state).toMatchObject({ phase: 'travelling', attacksMade: 0 });
    await moveTime(500);
    expect(getGameSnapshot(mockDb).latestBattle?.state).toMatchObject({ tick: 3, phase: 'fighting', lastAction: 'attack', attacksMade: 1 });
    const damage = getGameSnapshot(mockDb).latestBattle!.state.impacts![0].amount;
    expect(screen.getByLabelText(`${damage} damage to enemy`)).toHaveTextContent(`−${damage}`);
  });

  it('opens combat outside the tabs with landscape and hidden system bars, then restores the picker', async () => {
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    expect(screen.getByTestId('fullscreen-expedition')).toBeVisible();
    const playingScreen = screen.container.queryAll(item => item.props.screenOrientation === 'landscape')[0];
    expect(playingScreen?.props).toMatchObject({ statusBarHidden: true, navigationBarHidden: true });
    await press('← Expeditions');
    expect(screen.queryByTestId('fullscreen-expedition')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue expedition' })).toBeVisible();
    expect(screen.container.queryAll(item => item.props.screenOrientation === 'portrait' && item.props.statusBarHidden === false && item.props.navigationBarHidden === false).length > 0).toBe(true);
    const tick = getGameSnapshot(mockDb).latestBattle?.state.tick;
    await moveTime(5000);
    expect(getGameSnapshot(mockDb).latestBattle?.state.tick).toBe(tick);
  });

  it('dismisses an old defeat, keeps it dismissed after remounting, and enters Wetlands', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'refunded-reserve', startedAt: NOW - 60000, endedAt: NOW, validReps: 4, partialReps: 0 });
    const old = gameRepository.startDungeon(mockDb, 0);
    const { dungeon: _snapshot, ...legacy } = old.state;
    mockDb.update(dungeonRuns).set({ status: 'defeat', state: { ...legacy, status: 'defeat', heroHp: 0 } }).run();
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByText('Mossfall Hollow')).toBeVisible();
    expect(screen.getByText(/This expedition has ended.*back at camp/)).toBeVisible();
    await press('Choose a new expedition');
    expect(screen.queryByText('Mossfall Hollow')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
    await cleanup();
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.queryByText('Expedition result')).toBeNull();
    await press('Enter dungeon  →');
    expect(getGameSnapshot(mockDb).latestBattle?.state.dungeon?.name).toBe('Wetlands');
    expect(mockDb.select().from(dungeonRuns).all()).toHaveLength(2);
  });

  it('allows zero-pushup entry and offers training for more damage', async () => {
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByText(/Attacks never consume pushups/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
    mockReadout.value.reps = 4;
    await press('Train pushups');
    await fireEvent.press(screen.getByText('Finish & save'));
    await press('Return to camp');
    await navigate('/dungeon');
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
    expect(getGameSnapshot(mockDb).savedPushups).toBe(4);
  });

  it('explains zero health and offers step recovery before entry', async () => {
    gameRepository.getHero(mockDb);
    mockDb.update(heroes).set({ damageDay: '2026-09-06', damageTaken: 100 }).run();
    savePushupWorkout(mockDb, { sourceKey: 'reserve', startedAt: NOW - 60000, endedAt: NOW, validReps: 4, partialReps: 0 });
    await renderRouter(routes, { initialUrl: '/dungeon' });
    expect(screen.getByRole('button', { name: 'Recover health to enter' })).toBeDisabled();
    await press('Sync steps for health');
    await press('Connect Test Health');
    await press('← Camp');
    await navigate('/dungeon');
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
  });

  it('keeps an active workout mounted when refreshing its save fails', async () => {
    mockReadout.value.reps = 10;
    await renderRouter(routes);
    await press('Train pushups  ·  increase damage');
    jest.spyOn(gameRepository, 'getGameSnapshot').mockImplementationOnce(() => {
      throw new Error('Temporary database read failure');
    });
    await act(async () => { appStateListeners.forEach((listener) => listener('active')); });
    expect(screen.getByText('Finish & save')).toBeVisible();
    expect(screen.getByText('Stats could not refresh.')).toBeVisible();
    await press('Retry refresh');
    expect(screen.queryByText('Stats could not refresh.')).toBeNull();
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('+10 pushups saved')).toBeVisible();
  });

  it('finishes a camera workout with corrections and carries its damage bonus back to camp', async () => {
    mockReadout.value.reps = 20;
    mockReadout.value.partials = 3;
    mockAdjustment.value = 2;
    await renderRouter(routes);
    await press('Train pushups  ·  increase damage');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('A little stronger.')).toBeVisible();
    expect(screen.getByText('+22 pushups saved')).toBeVisible();
    expect(getGameSnapshot(mockDb).today).toMatchObject({ pushups: 22, partialReps: 3 });
    await press('Return to camp');
    expect(screen.getByText('+22 saved today')).toBeVisible();
  });

  it('can return to camp when camera permission is denied without saving a workout', async () => {
    mockCameraPermission = false;
    await renderRouter(routes);
    await press('Train pushups  ·  increase damage');
    expect(screen.getByText('Camera permission is required to count reps.')).toBeVisible();
    await press('Back to camp');
    expect(screen.getByText('Welcome to camp.')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(0);
  });

  it('retains the camera count after a failed save and allows a successful retry', async () => {
    mockReadout.value.reps = 12;
    mockDb.run("CREATE TRIGGER fail_workout BEFORE INSERT ON sets BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    await renderRouter(routes);
    await press('Train pushups  ·  increase damage');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(Alert.alert).toHaveBeenCalledWith('Could not save', expect.any(String));
    expect(screen.getByText('Finish & save')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(0);
    mockDb.run('DROP TRIGGER fail_workout');
    await fireEvent.press(screen.getByText('Finish & save'));
    expect(screen.getByText('+12 pushups saved')).toBeVisible();
    expect(getGameSnapshot(mockDb).totals.pushups).toBe(12);
  });

  it('offers to save an unfinished workout when using back navigation', async () => {
    mockReadout.value.reps = 10;
    await renderRouter(routes);
    await press('Train pushups  ·  increase damage');
    await act(async () => { router.back(); });
    expect(Alert.alert).toHaveBeenCalledWith('Save your pushups?', expect.any(String), expect.any(Array));
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    await act(async () => { buttons?.find((button) => button.text === 'Save workout')?.onPress?.(); });
    expect(screen.getByText('+10 pushups saved')).toBeVisible();
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

  it('claims earned quests once and sells an unequipped item through inventory', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'earned-pushups', startedAt: NOW - 60_000, endedAt: NOW, validReps: 20, partialReps: 2 });
    await renderRouter(routes);
    await press('Claim gold');
    expect(screen.getByRole('button', { name: 'Claimed ✓' })).toBeDisabled();
    await press('Connect steps');
    await press('Connect Test Health');
    await press('← Camp');
    await press('Claim gold');
    await navigate('/forge');
    await press('Weapon: Wooden Club');
    expect(screen.getByRole('button', { name: 'Sell for 5 gold' })).toBeDisabled();
    await press('Unequip to bag');
    await press('Sell for 5 gold');
    expect(getGameSnapshot(mockDb).hero.gold).toBe(45);
    expect(screen.getByRole('button', { name: 'Weapon: Empty' })).toBeDisabled();
    expect(screen.queryByText(/Upgrade/)).toBeNull();
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
    await press('Continue expedition');
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
    gameRepository.saveStepTotal(mockDb, '2026-09-06', 20000);
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    for (let tick = 0; tick < 65; tick++) await moveTime(800);
    expect(screen.getByText('Boss defeated. Well fought.')).toBeVisible();
    expect(getGameSnapshot(mockDb).hero).toMatchObject({ gold: 72, xp: 99, unlockedDungeon: 1 });
    await press('Choose a new expedition');
    expect(screen.getByRole('button', { name: 'Select Wetlands, available' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Select Embercrypt, selected' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Select Frostbound Keep, locked' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enter dungeon  →' })).toBeEnabled();
    await press('Enter dungeon  →');
    expect(getGameSnapshot(mockDb).latestBattle?.state.dungeonId).toBe(1);
  });

  it('keeps fighting without spending pushups and allows retrying after defeat', async () => {
    savePushupWorkout(mockDb, { sourceKey: 'two-attacks', startedAt: NOW - 60_000, endedAt: NOW, validReps: 2, partialReps: 0 });
    await renderRouter(routes, { initialUrl: '/dungeon' });
    await press('Enter dungeon  →');
    for (let tick = 0; tick < 100; tick++) await moveTime(800);
    expect(screen.getByText('Entry health restored. Daily bonuses reset at 5 AM device time.')).toBeVisible();
    expect(getGameSnapshot(mockDb).latestBattle?.state.attacksMade).toBeGreaterThan(2);
    expect(screen.getByRole('button', { name: 'Try this dungeon again' })).toBeEnabled();
    expect(getGameSnapshot(mockDb)).toMatchObject({ savedPushups: 2, hero: { gold: 0, xp: 0 }, today: { pushups: 2 } });
    await press('Try this dungeon again');
    expect(getGameSnapshot(mockDb).latestBattle?.state.stats.pushups).toBe(2);
  });

  it('equips a found amulet and drinks a focus potion through inventory', async () => {
    gameRepository.getHero(mockDb);
    mockDb.update(heroes).set({ gold: 200, unlockedDungeon: 1 }).run();
    giveItem(mockDb, GEAR.restraint_amulet);
    savePushupWorkout(mockDb, { sourceKey: 'reserve', startedAt: NOW - 60_000, endedAt: NOW, validReps: 9, partialReps: 0 });
    await renderRouter(routes, { initialUrl: '/forge' });
    await press('Inspect Amulet of Restraint');
    await press('Equip to Amulet');
    await press('Close item');
    await press('Supplies');
    await press('Buy focus potion  ·  ◆ 25 gold');
    await press('Drink focus potion');
    expect(screen.getByRole('button', { name: 'Drink focus potion' })).toBeDisabled();
    expect(getGameSnapshot(mockDb)).toMatchObject({ damage: 54, savedPushups: 9,
      hero: { gold: 175, focusPotions: 0, focusAttacks: 10 } });
    await navigate('/');
    expect(screen.getByText(/2.17× damage/)).toBeVisible();
  });

  it.each(['open', 'backgrounded', 'closed'] as const)('resets bonuses at 5 AM when the app was %s without deleting history', async mode => {
    const late = new Date(2026, 8, 7, 4, 59, 59).getTime();
    jest.setSystemTime(late);
    savePushupWorkout(mockDb, { sourceKey: 'late-training', startedAt: late - 60_000, endedAt: late, validReps: 20, partialReps: 0 });
    gameRepository.saveStepTotal(mockDb, '2026-09-06', 6000);
    await renderRouter(routes);
    expect(screen.getByText('+20 saved today')).toBeVisible();
    expect(screen.getByText(/3× damage/)).toBeVisible();
    expect(screen.getByText('6,000')).toBeVisible();
    if (mode === 'backgrounded') await act(async () => { appStateListeners.forEach(listener => listener('background')); });
    if (mode === 'closed') await cleanup();
    await moveTime(1000);
    if (mode === 'backgrounded') await act(async () => { appStateListeners.forEach(listener => listener('active')); });
    if (mode === 'closed') await renderRouter(routes);
    expect(screen.queryByText('+20 saved today')).toBeNull();
    expect(screen.queryByText('6,000')).toBeNull();
    const snapshot = getGameSnapshot(mockDb);
    expect(snapshot.today.pushups).toBe(0);
    expect(snapshot.stats.dailyHealth).toBe(0);
    expect(snapshot.savedPushups).toBe(20);
    expect(screen.getByText(/1× damage/)).toBeVisible();
    expect(snapshot.history.find((day) => day.day === '2026-09-06')?.pushups).toBe(20);
  });

  it('keeps daily pushup and step power through midnight', async () => {
    const late = new Date(2026, 8, 6, 23, 59, 59).getTime();
    jest.setSystemTime(late);
    savePushupWorkout(mockDb, { sourceKey: 'midnight-training', startedAt: late - 60_000, endedAt: late, validReps: 20, partialReps: 0 });
    gameRepository.saveStepTotal(mockDb, '2026-09-06', 6000);
    await renderRouter(routes);
    await moveTime(1000);
    expect(screen.getByText('+20 saved today')).toBeVisible();
    expect(screen.getByText(/3× damage/)).toBeVisible();
    expect(screen.getByText('6,000')).toBeVisible();
    expect(getGameSnapshot(mockDb).today.day).toBe('2026-09-06');
  });
});
