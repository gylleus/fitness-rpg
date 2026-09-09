import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as schema from './schema';
import { createTestDb } from '../../test/db';
import { advanceDungeon, claimChallenge, getGameSnapshot, getHero, getPushupUnits, purchaseAmulet, purchasePotion,
  retreatDungeon, expireBattles, savePushupWorkout, saveRun, saveStepTotal, startDungeon, drinkPotion } from './game';

const now = new Date(2026, 8, 6, 12).getTime();
const tomorrow = new Date(2026, 8, 7, 12).getTime();
const day = '2026-09-06';
const workout = { sourceKey: 'training', startedAt: now - 60000, endedAt: now, validReps: 100, partialReps: 3 };
const databases: ReturnType<typeof createTestDb>[] = [];
function database(filename?: string) {
  const db = createTestDb(filename);
  databases.push(db);
  return db;
}
afterEach(() => { for (const db of databases.splice(0)) if (db.$client.open) db.$client.close(); });
function nextAttack(db: ReturnType<typeof createTestDb>, run: ReturnType<typeof startDungeon>) {
  for (let i = 0; i < 10 && run.status === 'active'; i++) {
    const attacks = run.state.attacksMade;
    const next = advanceDungeon(db, run.id, run.state.tick, now)!;
    if (next.state.attacksMade > attacks) return next;
    run = next;
  }
  throw new Error('No paid attack occurred.');
}

describe('pushup stockpile persistence', () => {
  it('blocks entry without resources and credits full reps once without a daily expiry', () => {
    const db = database();
    expect(() => startDungeon(db, 0, now)).toThrow(/stockpile/);
    savePushupWorkout(db, workout);
    savePushupWorkout(db, workout);
    expect(getGameSnapshot(db, now)).toMatchObject({ pushupUnits: 10000, attacksAvailable: 100, today: { pushups: 100, partialReps: 3 } });
    expect(getGameSnapshot(db, tomorrow)).toMatchObject({ pushupUnits: 10000, attacksAvailable: 100, today: { pushups: 0 } });
  });

  it('charges each actual attack once and leaves fitness history and quests untouched', () => {
    const db = database();
    savePushupWorkout(db, workout);
    let run = startDungeon(db, 0, now);
    for (let i = 0; i < 3; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
    expect(getPushupUnits(db)).toBe(10000);
    const tick = run.state.tick;
    run = advanceDungeon(db, run.id, tick, now)!;
    expect(getPushupUnits(db)).toBe(9900);
    expect(advanceDungeon(db, run.id, tick, now)).toEqual(run);
    expect(getPushupUnits(db)).toBe(9900);
    run = advanceDungeon(db, run.id, run.state.tick, now)!; // Enemy attacks for free.
    expect(getPushupUnits(db)).toBe(9900);
    expect(claimChallenge(db, 'pushups', now)).toBe(true);
    expect(getGameSnapshot(db, now).today.pushups).toBe(100);
    retreatDungeon(db, run.id);
    retreatDungeon(db, run.id);
    expect(getPushupUnits(db)).toBe(10000);
    expect(startDungeon(db, 0, now).state.pushupUnits).toBe(10000);
  });

  it('restores fractional costs exactly after reopening and retreating, preserving meters', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fitness-stockpile-'));
    const path = join(directory, 'game.db');
    const db = database(path);
    let reopened: Database.Database | undefined;
    try {
      savePushupWorkout(db, workout);
      getHero(db);
      db.update(schema.heroes).set({ amuletOwned: true, focusAttacks: 10 }).run();
      saveRun(db, day, { distanceMeters: 10000, durationSeconds: 4500, steps: 10000 }, 'agility', now);
      let run = nextAttack(db, startDungeon(db, 0, now));
      run = advanceDungeon(db, run.id, run.state.tick, now)!; // First incoming hit.
      const before = getGameSnapshot(db, now);
      expect(before.hero).toMatchObject({ pushupUnitsSpent: 70, focusAttacks: 9, combatMeters: { dodge: 2000 } });
      db.$client.close();
      reopened = new Database(path);
      const restored = drizzle(reopened, { schema });
      expect(getGameSnapshot(restored, now)).toEqual(before);
      retreatDungeon(restored, run.id);
      const retry = startDungeon(restored, 0, now);
      expect(retry.state).toMatchObject({ pushupUnits: 10000, focusAttacks: 9, meters: { dodge: 2000 } });
    } finally {
      reopened?.close();
      if (db.$client.open) db.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refunds an exhausted attempt once and allows an immediate retry', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 2 });
    const entry = startDungeon(db, 0, now);
    let run = entry;
    for (let i = 0; i < 50 && run.status === 'active'; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
    expect(run).toMatchObject({ status: 'exhausted', state: { gold: 0, xp: 0, attacksMade: 2 } });
    expect(getGameSnapshot(db, now)).toMatchObject({ currentHealth: entry.state.entryHp, pushupUnits: 200, hero: { gold: 0, xp: 0 } });
    expect(advanceDungeon(db, run.id, run.state.tick - 1, now)).toEqual(run);
    const retry = startDungeon(db, 0, now);
    expect(retry.state.pushupUnits).toBe(200);
    advanceDungeon(db, run.id, run.state.tick, now);
    expect(getPushupUnits(db)).toBe(200);
  });

  it('uses newly saved pushups when a paused battle resumes', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    let run = nextAttack(db, startDungeon(db, 0, now));
    savePushupWorkout(db, { ...workout, sourceKey: 'more-training', validReps: 1 });
    run = nextAttack(db, run);
    expect(run.state).toMatchObject({ attacksMade: 2, defeated: 1, pushupUnits: 0 });
  });

  it('refunds costs without losing pushups earned during a paused attempt', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 2 });
    const run = nextAttack(db, startDungeon(db, 0, now));
    savePushupWorkout(db, { ...workout, sourceKey: 'new-workout', validReps: 3 });
    retreatDungeon(db, run.id);
    expect(getPushupUnits(db)).toBe(500);
    expect(getGameSnapshot(db, now).today.pushups).toBe(5);
  });

  it.each(['defeat', 'exhausted', 'retreated', 'expired'] as const)('rolls back a failed %s refund and permits exactly one retry', status => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    getHero(db);
    if (status === 'defeat') db.update(schema.heroes).set({ damageDay: day, damageTaken: 99 }).run();
    let run = nextAttack(db, startDungeon(db, 0, now));
    if (status === 'exhausted') run = advanceDungeon(db, run.id, run.state.tick, now)!; // Enemy retaliates, then no ammo.
    const before = getGameSnapshot(db, now);
    const finish = () => status === 'retreated' ? retreatDungeon(db, run.id)
      : status === 'expired' ? expireBattles(db, tomorrow)
        : advanceDungeon(db, run.id, run.state.tick, now);
    db.run("CREATE TRIGGER fail_refund BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(finish).toThrow();
    expect(getGameSnapshot(db, now)).toEqual(before);
    db.run('DROP TRIGGER fail_refund');
    finish();
    finish();
    const result = getGameSnapshot(db, status === 'expired' ? tomorrow : now);
    expect(result).toMatchObject({ pushupUnits: 100, hero: { pushupUnitsSpent: 0, gold: 0, xp: 0 },
      latestBattle: { status, state: { pushupUnits: 100, pushupUnitsSpent: 100 } } });
  });

  it('rolls back a failed paid checkpoint, including focus charge and effect meters', () => {
    const db = database();
    savePushupWorkout(db, workout);
    getHero(db);
    db.update(schema.heroes).set({ focusAttacks: 10 }).run();
    let run = startDungeon(db, 0, now);
    for (let i = 0; i < 3; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
    const before = getGameSnapshot(db, now);
    db.run("CREATE TRIGGER fail_turn BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(() => advanceDungeon(db, run.id, run.state.tick, now)).toThrow();
    expect(getGameSnapshot(db, now)).toEqual(before);
    db.run('DROP TRIGGER fail_turn');
    expect(advanceDungeon(db, run.id, run.state.tick, now)?.state.pushupUnits).toBe(9920);
    expect(getHero(db).focusAttacks).toBe(9);
  });

  it('refunds expired attempts once while preserving focus and meter progress', () => {
    const db = database();
    savePushupWorkout(db, workout);
    saveRun(db, day, { distanceMeters: 10000, durationSeconds: 4500, steps: 10000 }, 'agility', now);
    getHero(db);
    db.update(schema.heroes).set({ focusAttacks: 10 }).run();
    const run = nextAttack(db, startDungeon(db, 0, now));
    advanceDungeon(db, run.id, run.state.tick, now);
    const tomorrowSnapshot = getGameSnapshot(db, tomorrow);
    expect(tomorrowSnapshot).toMatchObject({ pushupUnits: 10000, stats: { dodgeBps: 0, dailyHealth: 0 },
      hero: { focusAttacks: 9, combatMeters: { dodge: 2000 } }, latestBattle: { status: 'expired' } });
    expireBattles(db, tomorrow);
    expect(startDungeon(db, 0, tomorrow).state.pushupUnits).toBe(10000);
  });
});

describe('gold items', () => {
  it('enforces the rare amulet unlock, price, and single ownership', () => {
    const db = database();
    getHero(db);
    db.update(schema.heroes).set({ gold: 149, unlockedDungeon: 1 }).run();
    expect(() => purchaseAmulet(db)).toThrow();
    db.update(schema.heroes).set({ gold: 200, unlockedDungeon: 0 }).run();
    expect(() => purchaseAmulet(db)).toThrow();
    db.update(schema.heroes).set({ unlockedDungeon: 1 }).run();
    purchaseAmulet(db);
    expect(getHero(db)).toMatchObject({ gold: 50, amuletOwned: true });
    expect(getGameSnapshot(db, now).attackCostUnits).toBe(90);
    expect(() => purchaseAmulet(db)).toThrow();
    expect(getHero(db).gold).toBe(50);
  });

  it('buys and consumes potions atomically, forbids wasted use and use during combat', () => {
    const db = database();
    getHero(db);
    db.update(schema.heroes).set({ gold: 100 }).run();
    purchasePotion(db, 'health');
    purchasePotion(db, 'efficiency');
    expect(getHero(db)).toMatchObject({ gold: 45, healthPotions: 1, focusPotions: 1 });
    expect(() => drinkPotion(db, 'health', now)).toThrow(/full/);
    db.update(schema.heroes).set({ damageDay: day, damageTaken: 25 }).run();
    drinkPotion(db, 'health', now);
    drinkPotion(db, 'efficiency', now);
    expect(getHero(db)).toMatchObject({ healthPotions: 0, focusPotions: 0, damageTaken: 0, focusAttacks: 10 });
    purchasePotion(db, 'efficiency');
    expect(() => drinkPotion(db, 'efficiency', now)).toThrow(/active/);
    expect(() => purchasePotion(db, 'health')).toThrow();
    savePushupWorkout(db, workout);
    const run = startDungeon(db, 0, now);
    expect(() => drinkPotion(db, 'efficiency', now)).toThrow(/camp/);
    expect(getHero(db).focusPotions).toBe(1);
    retreatDungeon(db, run.id);
    expect(getGameSnapshot(db, tomorrow).hero.focusAttacks).toBe(10);
  });

  it('ends focus exactly after ten paid swings and never refunds it on retreat', () => {
    const db = database();
    savePushupWorkout(db, workout);
    getHero(db);
    db.update(schema.heroes).set({ focusAttacks: 10, amuletOwned: true }).run();
    saveStepTotal(db, day, 10000);
    let run = startDungeon(db, 0, now);
    for (let i = 0; i < 11; i++) run = nextAttack(db, run);
    expect(getHero(db)).toMatchObject({ pushupUnitsSpent: 790, focusAttacks: 0 });
    retreatDungeon(db, run.id);
    expect(getPushupUnits(db)).toBe(10000);
    expect(getHero(db).focusAttacks).toBe(0);
    expect(getGameSnapshot(db, now).attackCostUnits).toBe(90);
  });

  it('rolls back a failed item write without losing gold or inventory', () => {
    const db = database();
    getHero(db);
    db.update(schema.heroes).set({ gold: 100, healthPotions: 1, damageDay: day, damageTaken: 50 }).run();
    const before = getHero(db);
    db.run("CREATE TRIGGER fail_item BEFORE UPDATE ON heroes BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(() => purchasePotion(db, 'efficiency')).toThrow();
    expect(() => drinkPotion(db, 'health', now)).toThrow();
    expect(getHero(db)).toEqual(before);
  });
});

it('migrates old free-attack battles without losing banked progress or workouts', () => {
  const sqlite = new Database(':memory:');
  try {
    for (const tag of ['0000_last_sinister_six', '0001_fitness_game', '0002_native_activity_and_expeditions']) {
      sqlite.exec(readFileSync(join(__dirname, `migrations/${tag}.sql`), 'utf8'));
    }
    sqlite.exec(`INSERT INTO heroes (id, gold, xp, sword_level) VALUES (1, 70, 85, 2);
      INSERT INTO sessions (id, exercise, started_at, ended_at) VALUES (1, 'pushup', ${now}, ${now});
      INSERT INTO sets (session_id, valid_reps, partial_reps, started_at, ended_at) VALUES (1, 12, 3, ${now}, ${now});`);
    const legacy = { status: 'active', dungeonId: 0, day, stats: { attack: 50, health: 100, level: 1 }, gold: 8, xp: 10, log: [], entryHp: 100 };
    sqlite.prepare('INSERT INTO dungeon_runs (started_at, status, state) VALUES (?, ?, ?)').run(now, 'active', JSON.stringify(legacy));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0003_attack_stockpile.sql'), 'utf8'));
    const db = drizzle(sqlite, { schema });
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot).toMatchObject({ pushupUnits: 1200, hero: { gold: 70, xp: 85, swordLevel: 2 },
      latestBattle: { status: 'retreated', state: { gold: 0, xp: 0, attacksMade: 0, stats: { dodgeBps: 0, attackEffects: [] } } } });
    expect(db.select().from(schema.sets).where(eq(schema.sets.sessionId, 1)).get()?.partialReps).toBe(3);
    expect(getGameSnapshot(db, now).pushupUnits).toBe(1200);
  } finally { sqlite.close(); }
});
