import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from './schema';
import { giveItem } from '../../test/equipment';
import { GEAR, startingEquipment } from '../game/equipment';
import { getInventory, equipItem, sellItem } from './inventory';
import { advanceExpedition } from '../../test/expeditions';
import { createTestDb } from '../../test/db';
import { advanceDungeon, claimChallenge, deleteRun, getFitnessDay, getGameSnapshot, getHero, retreatDungeon, savePushupWorkout, saveRun, saveStepTotal, startDungeon } from './game';
import { activityDays, challengeClaims, dungeonRuns, heroes, runs, sessions, sets } from './schema';
import { localDay } from '../game/rules';

const now = new Date(2026, 8, 6, 12).getTime();
const today = localDay(now);
const tomorrow = new Date(2026, 8, 7, 12).getTime();
const runActivity = { distanceMeters: 2000, durationSeconds: 900, steps: 2000 };
const workout = { sourceKey: 'camera-1', startedAt: now - 60_000, endedAt: now, validReps: 20, partialReps: 3 };

describe('fitness persistence', () => {
  it('adds the game schema to an old workout database without losing records', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0000_last_sinister_six.sql'), 'utf8'));
      sqlite.prepare('INSERT INTO sessions (exercise, started_at, ended_at) VALUES (?, ?, ?)').run('pushup', now - 1000, now);
      sqlite.prepare('INSERT INTO sets (session_id, valid_reps, partial_reps, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').run(1, 12, 2, now - 1000, now);
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0001_fitness_game.sql'), 'utf8'));
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0002_native_activity_and_expeditions.sql'), 'utf8'));
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0003_attack_stockpile.sql'), 'utf8'));
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0004_dungeon_recovery.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0005_pushup_damage.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0006_inventory.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0007_daily_fitness_reset.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0008_camp_expeditions.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0009_dev_travel_steps.sql'), 'utf8'));
      const migrated = drizzle(sqlite, { schema });
      expect(getGameSnapshot(migrated, now).today).toMatchObject({ pushups: 12, partialReps: 2 });
      expect(migrated.select().from(sessions).get()?.sourceKey).toBeNull();
    } finally { sqlite.close(); }
  });
  it('restores workout, equipment, claims, and battle after closing and reopening the file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fitness-rpg-save-'));
    const filename = join(directory, 'game.db');
    const db = createTestDb(filename);
    let reopened: Database.Database | undefined;
    try {
      savePushupWorkout(db, { ...workout, validReps: 100 });
      saveStepTotal(db, today, 6000);
      saveRun(db, today, runActivity, 'persistent-run', now);
      claimChallenge(db, 'pushups', now);
      claimChallenge(db, 'steps', now);
      giveItem(db, GEAR.hide_armor, 'armor');
      const battle = startDungeon(db, 0, now);
      advanceDungeon(db, battle.id, 0, now);
      const before = getGameSnapshot(db, now);
      db.$client.close();
      reopened = new Database(filename);
      const restored = drizzle(reopened, { schema });
      expect(getGameSnapshot(restored, now)).toEqual(before);
      expect(claimChallenge(restored, 'pushups', now)).toBe(false);
      expect(advanceDungeon(restored, battle.id, 0, now)).toEqual(before.latestBattle);
      expect(getHero(restored).gold).toBe(before.hero.gold);
    } finally {
      if (db.$client.open) db.$client.close();
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('starts empty with seven honest zero days', () => {
    const snapshot = getGameSnapshot(createTestDb(), now);
    expect(snapshot.history).toHaveLength(7);
    expect(snapshot.totals.pushups).toBe(0);
    expect(snapshot.today.steps).toBe(0);
    expect(snapshot.latestBattle).toBeNull();
    expect(snapshot.hero.gold).toBe(0);
  });
  it('saves a camera workout atomically and deduplicates a retried save', () => {
    const db = createTestDb();
    const first = savePushupWorkout(db, workout);
    expect(savePushupWorkout(db, workout)).toBe(first);
    expect(db.select().from(sessions).all()).toHaveLength(1);
    expect(db.select().from(sets).all()).toHaveLength(1);
    expect(getFitnessDay(db, today)).toMatchObject({ pushups: 20, partialReps: 3 });
    expect(getGameSnapshot(db, now).stats.attack).toBe(75);
  });
  it('rejects an invalid workout before saving any session or set', () => {
    const db = createTestDb();
    expect(() => savePushupWorkout(db, { ...workout, validReps: NaN })).toThrow();
    expect(() => savePushupWorkout(db, { ...workout, endedAt: now - 120_000 })).toThrow();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
  it('includes existing pushup sessions and excludes other exercise types', () => {
    const db = createTestDb();
    const pushups = db.insert(sessions).values({ exercise: 'pushup', startedAt: now }).returning().get();
    const squats = db.insert(sessions).values({ exercise: 'squat', startedAt: now }).returning().get();
    for (const s of [pushups, squats]) db.insert(sets).values({ sessionId: s.id, validReps: 10, startedAt: now, endedAt: now }).run();
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot.today.pushups).toBe(10);
    expect(snapshot.totals.pushups).toBe(10);
  });
  it('replaces a daily total instead of adding repeated watch totals', () => {
    const db = createTestDb();
    saveStepTotal(db, today, 5000);
    saveStepTotal(db, today, 6000);
    saveRun(db, today, runActivity, 'run-1', now);
    saveRun(db, today, runActivity, 'run-1', now);
    expect(db.select().from(activityDays).all()).toHaveLength(1);
    expect(db.select().from(runs).all()).toHaveLength(1);
    expect(getGameSnapshot(db, now).stats.dailyHealth).toBe(0);
  });
  it('recalculates power and history when an incorrect manual run is deleted', () => {
    const db = createTestDb();
    saveStepTotal(db, today, 6000);
    saveRun(db, today, runActivity, 'run-1', now);
    const id = db.select().from(runs).get()!.id;
    deleteRun(db, id);
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot.stats.dailyHealth).toBe(0);
    expect(snapshot.totals.runs).toBe(0);
    expect(snapshot.today.distanceMeters).toBe(0);
  });
  it('keeps multiple runs at different speeds distinct', () => {
    const db = createTestDb();
    saveRun(db, today, runActivity, 'run-1', now);
    saveRun(db, today, { ...runActivity, durationSeconds: 600 }, 'run-2', now);
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot.today.steps).toBe(4000);
    expect(snapshot.stats.dailyHealth).toBe(0);
    expect(snapshot.totals.distanceMeters).toBe(4000);
  });
  it('resets daily power while preserving fitness history and permanent upgrades', () => {
    const db = createTestDb();
    savePushupWorkout(db, workout);
    saveStepTotal(db, today, 6000);
    saveRun(db, today, runActivity, 'run-1', now);
    getHero(db);
    db.update(heroes).set({ gold: 123, xp: 250, unlockedDungeon: 1 }).run();
    for (const gear of startingEquipment(2, 1)) giveItem(db, gear.item, gear.slot);
    const nextDay = getGameSnapshot(db, tomorrow);
    expect(nextDay.stats).toMatchObject({ attack: 33, pushups: 0, damageMultiplier: 1, health: 130, dodgeBps: 0, dailyHealth: 0 });
    expect(nextDay.hero).toMatchObject({ gold: 123, xp: 250, unlockedDungeon: 1 });
    expect(nextDay.history.find((d) => d.day === today)).toMatchObject({ pushups: 20, steps: 6000, distanceMeters: 2000 });
    expect(nextDay.totals).toMatchObject({ pushups: 20, bestPushupDay: 20, runs: 1 });
  });
  it('credits a workout spanning the 5 AM reset to its completion fitness day', () => {
    const db = createTestDb();
    const reset = new Date(2026, 8, 7, 5).getTime();
    savePushupWorkout(db, { ...workout, startedAt: reset - 30_000, endedAt: reset });
    expect(getFitnessDay(db, today).pushups).toBe(0);
    expect(getFitnessDay(db, localDay(reset)).pushups).toBe(20);
  });
  it('rejects malformed dates and invalid activity without altering history', () => {
    const db = createTestDb();
    expect(() => saveStepTotal(db, '2026-02-31', 10)).toThrow();
    expect(() => saveStepTotal(db, today, -10)).toThrow();
    expect(() => saveRun(db, today, { ...runActivity, durationSeconds: 0 }, 'bad')).toThrow();
    expect(getGameSnapshot(db, now).totals.runs).toBe(0);
  });
});

describe('rewards and equipment', () => {
  it('grants each challenge only once per day and permits a new daily claim', () => {
    const db = createTestDb();
    expect(() => claimChallenge(db, 'pushups', now)).toThrow();
    savePushupWorkout(db, workout);
    saveStepTotal(db, today, 3000);
    saveRun(db, today, runActivity, 'run-1', now);
    for (const id of ['pushups', 'steps', 'run'] as const) {
      expect(claimChallenge(db, id, now)).toBe(true);
      expect(claimChallenge(db, id, now)).toBe(false);
    }
    expect(getHero(db).gold).toBe(60);
    expect(db.select().from(challengeClaims).all()).toHaveLength(3);
    expect(() => claimChallenge(db, 'pushups', tomorrow)).toThrow();
    savePushupWorkout(db, { ...workout, sourceKey: 'camera-2', startedAt: tomorrow - 60_000, endedAt: tomorrow });
    expect(claimChallenge(db, 'pushups', tomorrow)).toBe(true);
    expect(getHero(db).gold).toBe(80);
  });
  it('equips collected gear and sells the replaced item exactly once', () => {
    const db = createTestDb();
    const found = giveItem(db, GEAR.iron_club);
    const old = getInventory(db).find(item => item.slot === 'weapon')!;
    equipItem(db, found.id, 'weapon');
    expect(getGameSnapshot(db, now).stats.baseAttack).toBe(31);
    sellItem(db, old.id);
    expect(getHero(db).gold).toBe(5);
    expect(() => sellItem(db, old.id)).toThrow();
    expect(getHero(db).gold).toBe(5);
  });
});

describe('saved dungeons', () => {
  it('requires travel steps for premium paths and allows only one active attempt', () => {
    const db = createTestDb();
    savePushupWorkout(db, workout);
    expect(() => startDungeon(db, 2, now)).toThrow(/travel steps/);
    const first = startDungeon(db, 0, now);
    expect(startDungeon(db, 0, now).id).toBe(first.id);
    expect(db.select().from(dungeonRuns).all()).toHaveLength(1);
  });
  it('restores an in-progress battle with fixed entry stats', () => {
    const db = createTestDb();
    savePushupWorkout(db, { ...workout, sourceKey: 'initial', validReps: 1 });
    const first = startDungeon(db, 0, now);
    const next = advanceDungeon(db, first.id, 0, now)!;
    savePushupWorkout(db, workout);
    expect(getGameSnapshot(db, now).latestBattle).toEqual(next);
    expect(next.state.stats.attack).toBe(28);
    expect(getGameSnapshot(db, now).stats.attack).toBe(78);
    expect(advanceDungeon(db, first.id, 0, now)).toEqual(next);
  });
  it('awards enemy loot once despite repeated callbacks and refreshes on victory', () => {
    const db = createTestDb();
    savePushupWorkout(db, { ...workout, validReps: 100 });
    saveStepTotal(db, today, 20000);
    const first = startDungeon(db, 0, now);
    let checkpoint = first;
    for (let i = 0; checkpoint.status === 'active' && i < 1000; i++) {
      const tick = checkpoint.state.tick;
      checkpoint = advanceExpedition(db, checkpoint, now);
      expect(advanceDungeon(db, first.id, tick, now)).toEqual(checkpoint);
      // Simulate reading the persisted JSON after navigation/process restart.
      checkpoint = db.select().from(dungeonRuns).where(eq(dungeonRuns.id, first.id)).get()!;
    }
    expect(checkpoint.status).toBe('victory');
    expect(getHero(db)).toMatchObject({ gold: checkpoint.state.gold, xp: checkpoint.state.xp, unlockedDungeon: 0 });
    expect(advanceDungeon(db, first.id, checkpoint.state.tick, now)).toEqual(checkpoint);
    expect(getHero(db).gold).toBe(checkpoint.state.gold);
    expect(startDungeon(db, 1, now).state.dungeon?.mapGeneration).toBe(1);
  });
  it('retreats without loot and permits a fresh attempt', () => {
    const db = createTestDb();
    savePushupWorkout(db, { ...workout, validReps: 100 });
    saveStepTotal(db, today, 6000);
    const first = startDungeon(db, 0, now);
    let current = first;
    for (let i = 0; current.state.defeated === 0 && i < 100; i++) current = advanceExpedition(db, current, now);
    expect(current.state.gold).toBe(10);
    retreatDungeon(db, first.id);
    expect(getHero(db).gold).toBe(0);
    expect(advanceDungeon(db, first.id, 1, now)?.status).toBe('retreated');
    expect(startDungeon(db, 0, now).id).not.toBe(first.id);
  });
  it('expires yesterday’s battle before a stale turn can use old power', () => {
    const db = createTestDb();
    savePushupWorkout(db, { ...workout, validReps: 100 });
    saveStepTotal(db, today, 6000);
    const first = startDungeon(db, 0, now);
    advanceDungeon(db, first.id, 0, now);
    expect(advanceDungeon(db, first.id, 1, tomorrow)?.status).toBe('expired');
    expect(getHero(db).gold).toBe(0);
    const fresh = startDungeon(db, 0, tomorrow);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh.state.stats.dodgeBps).toBe(0);
  });
  it('rolls back loot if saving the battle checkpoint fails', () => {
    const db = createTestDb();
    savePushupWorkout(db, { ...workout, validReps: 100 });
    saveStepTotal(db, today, 6000);
    const first = startDungeon(db, 0, now);
    db.run(sqlForFailingCheckpoint);
    expect(() => advanceDungeon(db, first.id, 0, now)).toThrow();
    expect(getHero(db).gold).toBe(0);
    expect(db.select().from(dungeonRuns).get()?.state.tick).toBe(0);
  });
});

const sqlForFailingCheckpoint = `CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'simulated disk error'); END`;
