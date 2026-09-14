import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test/db';
import { dayStart, localDay, nextDailyReset } from '../game/rules';
import { advanceDungeon, claimChallenge, getFitnessDay, getGameSnapshot, getHero, savePushupWorkout, saveStepTotal, startDungeon } from './game';
import { resetDailyData } from './dev';
import { createRecording } from './recordings';
import * as schema from './schema';

let db: ReturnType<typeof createTestDb>;
const now = new Date(2026, 8, 7, 4, 59).getTime();
beforeEach(() => { vi.stubGlobal('__DEV__', true); db = createTestDb(); });
afterEach(() => { db.$client.close(); vi.unstubAllGlobals(); });
const saveWorkout = (time: number, sourceKey: string) => savePushupWorkout(db,
  { sourceKey, startedAt: time - 60_000, endedAt: time, validReps: 20, partialReps: 3 });

it.each([now, new Date(2026, 8, 7, 5).getTime()])('resets only the current 5 AM fitness day at %i', time => {
  const day = localDay(time), start = dayStart(day), end = nextDailyReset(start);
  saveWorkout(start - 1, 'earlier');
  saveWorkout(start, 'at-start');
  saveWorkout(end - 1, 'before-end');
  saveWorkout(end, 'later');
  const previousDay = localDay(start - 1);
  saveStepTotal(db, previousDay, 4000);
  saveStepTotal(db, day, 6000);
  const otherExercise = db.insert(schema.sessions).values({ exercise: 'squat', startedAt: time }).returning().get();
  db.insert(schema.sets).values({ sessionId: otherExercise.id, startedAt: time, endedAt: time, validReps: 5 }).run();
  // A multi-day session must keep its older sets when today's sets are removed.
  const oldSession = db.select().from(schema.sessions).all()[0];
  db.insert(schema.sets).values({ sessionId: oldSession.id, startedAt: time, endedAt: time, validReps: 10 }).run();
  db.insert(schema.runRecordings).values({ id: 'finished-run', status: 'finished', startedAt: start, endedAt: time, segments: [] }).run();
  db.insert(schema.routePoints).values({ recordingId: 'finished-run', timestamp: time, latitude: 59, longitude: 18, accuracy: 5, segment: 0 }).run();
  db.insert(schema.runs).values({ source: 'gps', sourceKey: 'gps:finished-run', recordingId: 'finished-run', day,
    createdAt: time, distanceMeters: 2000, durationSeconds: 900, steps: 2000 }).run();
  db.insert(schema.challengeClaims).values({ day: previousDay, challengeId: 'pushups' }).run();
  claimChallenge(db, 'pushups', time);
  getHero(db);
  db.update(schema.heroes).set({ gold: 123, xp: 100, damageDay: day, damageTaken: 30, focusAttacks: 3, healthPotions: 2 }).run();
  db.insert(schema.healthConnections).values({ id: 1, enabled: true, syncedAt: time }).run();
  const active = startDungeon(db, 0, time);
  const before = getGameSnapshot(db, time);

  resetDailyData(db, time);
  const after = getGameSnapshot(db, time);
  expect(after).toMatchObject({
    today: { pushups: 0, partialReps: 0, steps: 0, distanceMeters: 0 }, claimed: [],
    stats: { dailyHealth: 0, dodgeBps: 0, damageMultiplier: 1 }, currentHealth: before.stats.baseHealth,
    hero: { ...before.hero, damageTaken: 0 }, inventory: before.inventory,
    latestBattle: { status: 'expired', state: { gold: 0, xp: 0, loot: [] } },
  });
  expect(getFitnessDay(db, previousDay)).toMatchObject({ pushups: 20, partialReps: 3, steps: 4000 });
  expect(getFitnessDay(db, localDay(end)).pushups).toBe(20);
  expect(after.totals.pushups).toBe(40);
  expect(db.select().from(schema.sessions).all().map(session => session.exercise)).toEqual(['pushup', 'pushup', 'squat']);
  expect(db.select().from(schema.sets).all().map(set => set.validReps)).toEqual([20, 20, 5]);
  expect(db.select().from(schema.runRecordings).all()).toEqual([]);
  expect(db.select().from(schema.routePoints).all()).toEqual([]);
  expect(db.select().from(schema.challengeClaims).all()).toEqual([{ day: previousDay, challengeId: 'pushups' }]);
  expect(db.select().from(schema.healthConnections).get()).toMatchObject({ enabled: false, syncedAt: null });
  expect(advanceDungeon(db, active.id, 0, time)?.status).toBe('expired');
  resetDailyData(db, time);
  expect(getGameSnapshot(db, time)).toEqual(after);
  saveWorkout(time, 'new-training');
  expect(getGameSnapshot(db, time).stats.pushups).toBe(20);
  expect(claimChallenge(db, 'pushups', time)).toBe(true);
});

it('rolls back the entire reset on a failed write', () => {
  saveWorkout(now, 'today');
  saveStepTotal(db, localDay(now), 6000);
  claimChallenge(db, 'pushups', now);
  startDungeon(db, 0, now);
  db.insert(schema.healthConnections).values({ id: 1, enabled: true, syncedAt: now }).run();
  const before = getGameSnapshot(db, now);
  db.run("CREATE TRIGGER fail_reset BEFORE UPDATE ON health_connections BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  expect(() => resetDailyData(db, now)).toThrow('disk error');
  expect(getGameSnapshot(db, now)).toEqual(before);
  expect(db.select().from(schema.healthConnections).get()?.enabled).toBe(true);
});

it.each(['recording', 'paused'] as const)('refuses a reset with a %s GPS run', status => {
  saveWorkout(now, 'today');
  createRecording(db, 'ongoing', now);
  db.update(schema.runRecordings).set({ status }).run();
  const before = getGameSnapshot(db, now);
  expect(() => resetDailyData(db, now)).toThrow('Finish or discard');
  expect(getGameSnapshot(db, now)).toEqual(before);
  expect(db.select().from(schema.runRecordings).get()?.status).toBe(status);
});

it('rejects direct reset calls in a production build', () => {
  saveWorkout(now, 'today');
  const before = getGameSnapshot(db, now);
  vi.stubGlobal('__DEV__', false);
  expect(() => resetDailyData(db, now)).toThrow('only available in development');
  expect(getGameSnapshot(db, now)).toEqual(before);
});
