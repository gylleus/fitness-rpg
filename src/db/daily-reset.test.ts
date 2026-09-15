import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, it } from 'vitest';
import { createTestDb } from '../../test/db';
import * as schema from './schema';
import journal from './migrations/meta/_journal.json';
import { beginBattle } from '../game/combat';
import { advanceDungeon, claimChallenge, getGameSnapshot, getHero, savePushupWorkout, saveRun, saveStepTotal, startDungeon } from './game';

const reset = new Date(2026, 8, 7, 5).getTime();
const yesterday = '2026-09-06';
const workout = { sourceKey: 'before-reset', startedAt: reset - 60_000, endedAt: reset - 1, validReps: 20, partialReps: 3 };

it('expires bonuses and stale combat at exactly 5 AM after reopening a saved game', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitness-daily-reset-'));
  const path = join(directory, 'game.db');
  const db = createTestDb(path);
  let reopened: Database.Database | undefined;
  try {
    savePushupWorkout(db, workout);
    saveStepTotal(db, yesterday, 6000);
    saveRun(db, yesterday, { distanceMeters: 2000, durationSeconds: 900, steps: 2000 }, 'run', reset - 1);
    claimChallenge(db, 'pushups', reset - 1);
    claimChallenge(db, 'steps', reset - 1);
    db.update(schema.heroes).set({ damageDay: yesterday, damageTaken: 30 }).run();
    const battle = startDungeon(db, 0, reset - 1);
    const before = getGameSnapshot(db, reset - 1);
    expect(before.stats).toMatchObject({ pushups: 20, attack: 75, dailyHealth: 0, dodgeBps: 400 });
    expect(before.currentHealth).toBe(70);
    db.$client.close();

    reopened = new Database(path);
    const restored = drizzle(reopened, { schema });
    // An old timer may fire before the UI has refreshed on resume.
    expect(advanceDungeon(restored, battle.id, battle.state.tick, reset)).toMatchObject({ status: 'expired', state: { tick: 0, gold: 0, xp: 0 } });
    const after = getGameSnapshot(restored, reset);
    expect(after).toMatchObject({
      today: { day: '2026-09-07', pushups: 0, partialReps: 0, steps: 0 },
      stats: { pushups: 0, attack: 25, dailyHealth: 0, dodgeBps: 0, damageMultiplier: 1 },
      currentHealth: 100, claimed: [], totals: before.totals, hero: before.hero, inventory: before.inventory,
    });
    expect(after.history.find(day => day.day === yesterday)).toEqual(before.today);
    expect(() => claimChallenge(restored, 'pushups', reset)).toThrow('not complete');
    expect(() => claimChallenge(restored, 'steps', reset)).toThrow('not complete');

    // New workouts and steps earn only the new day's power and rewards.
    savePushupWorkout(restored, { ...workout, sourceKey: 'after-reset', startedAt: reset - 30_000, endedAt: reset, validReps: 10 });
    saveStepTotal(restored, '2026-09-07', 3000);
    expect(claimChallenge(restored, 'pushups', reset)).toBe(true);
    expect(claimChallenge(restored, 'steps', reset)).toBe(true);
    const fresh = startDungeon(restored, 0, reset);
    expect(fresh.id).not.toBe(battle.id);
    expect(fresh.state.stats).toMatchObject({ pushups: 10, attack: 50, dailyHealth: 0, damageMultiplier: 2 });
    expect(getGameSnapshot(restored, reset)).toMatchObject({ savedPushups: 30, totals: { pushups: 30, bestPushupDay: 20 } });
  } finally {
    if (db.$client.open) db.$client.close();
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('groups pushup history by the same 5 AM boundary as damage and daily records', () => {
  const db = createTestDb();
  try {
    const evening = new Date(2026, 8, 6, 23).getTime();
    savePushupWorkout(db, { ...workout, sourceKey: 'evening', startedAt: evening - 60_000, endedAt: evening, validReps: 10 });
    savePushupWorkout(db, workout);
    savePushupWorkout(db, { ...workout, sourceKey: 'next-day', endedAt: reset, validReps: 5 });
    const snapshot = getGameSnapshot(db, reset);
    expect(snapshot.history.find(day => day.day === yesterday)?.pushups).toBe(30);
    expect(snapshot.today.pushups).toBe(5);
    expect(snapshot.stats.pushups).toBe(5);
    expect(snapshot.totals).toMatchObject({ pushups: 35, bestPushupDay: 30 });
  } finally { db.$client.close(); }
});

it('migrates active lifetime-power battles while preserving workouts, banked progress, and past results', () => {
  const sqlite = new Database(':memory:');
  try {
    for (const entry of journal.entries.filter(entry => entry.idx < 7)) {
      sqlite.exec(readFileSync(join(__dirname, `migrations/${entry.tag}.sql`), 'utf8'));
    }
    const db = drizzle(sqlite, { schema });
    const oldTime = new Date(2026, 8, 5, 12).getTime();
    savePushupWorkout(db, { ...workout, sourceKey: 'old-training', startedAt: oldTime - 60_000, endedAt: oldTime, validReps: 100 });
    savePushupWorkout(db, workout);
    saveStepTotal(db, yesterday, 6000);
    getHero(db);
    db.update(schema.heroes).set({ gold: 53, xp: 100, damageDay: yesterday, damageTaken: 25, focusAttacks: 3, healthPotions: 2 }).run();
    const fresh = db.insert(schema.dungeonRuns).values({ startedAt: reset - 1, status: 'active',
      state: beginBattle(0, yesterday, { health: 175, baseHealth: 115, dailyHealth: 60, level: 2,
        baseAttack: 26, attack: 338, dodgeBps: 0, pushups: 120, pushupDamageCoefficient: 0.1, damageMultiplier: 13, attackEffects: [] }, 150, { seed: 123 }) }).returning().get();
    const oldState = { ...fresh.state, stats: { ...fresh.state.stats, pushups: 120, attack: 338 }, gold: 10, xp: 15 };
    db.update(schema.dungeonRuns).set({ state: oldState }).run();
    const pastResult = db.insert(schema.dungeonRuns).values({ startedAt: oldTime, status: 'victory', state: { ...oldState, status: 'victory' } }).returning().get();
    db.insert(schema.runs).values({ source: 'gps', sourceKey: 'early-gps', day: '2026-09-07', createdAt: reset - 1, distanceMeters: 2000, durationSeconds: 900, steps: 2000 }).run();
    saveRun(db, yesterday, { distanceMeters: 1000, durationSeconds: 600, steps: 1000 }, 'manual', reset - 1);
    const preserved = () => ({ hero: getHero(db), inventory: db.select().from(schema.inventoryItems).all(),
      sessions: db.select().from(schema.sessions).all(), sets: db.select().from(schema.sets).all(),
      activity: db.select().from(schema.activityDays).all() });
    const before = preserved();

    sqlite.exec(readFileSync(join(__dirname, 'migrations/0007_daily_fitness_reset.sql'), 'utf8'));
    expect(preserved()).toEqual(before);
    expect(db.select().from(schema.dungeonRuns).all()).toEqual([
      expect.objectContaining({ id: fresh.id, status: 'expired', state: expect.objectContaining({ status: 'expired', gold: 0, xp: 0, loot: [] }) }),
      pastResult,
    ]);
    expect(db.select().from(schema.runs).all().map(run => ({ day: run.day, steps: run.steps }))).toEqual([
      { day: yesterday, steps: 2000 }, { day: yesterday, steps: 1000 },
    ]);
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0008_camp_expeditions.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0009_dev_travel_steps.sql'), 'utf8'));
    expect(advanceDungeon(db, fresh.id, 0, reset - 1)?.status).toBe('expired');
    const next = startDungeon(db, 0, reset - 1);
    expect(next.state.stats.pushups).toBe(20);
    expect(next.state.focusAttacks).toBe(3);
    expect(getGameSnapshot(db, reset).stats).toMatchObject({ pushups: 0, dailyHealth: 0, damageMultiplier: 1 });
  } finally { sqlite.close(); }
});
