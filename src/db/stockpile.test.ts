import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as schema from './schema';
import { giveItem } from '../../test/equipment';
import { GEAR } from '../game/equipment';
import { equipItem, unequipItem } from './inventory';
import { advanceExpedition } from '../../test/expeditions';
import { createTestDb } from '../../test/db';
import { advanceDungeon, claimChallenge, getGameSnapshot, getHero, getSavedPushups, purchasePotion,
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
    const next = advanceExpedition(db, run, now);
    if (next.state.attacksMade > attacks) return next;
    run = next;
  }
  throw new Error('No attack occurred.');
}

describe('saved pushup damage power', () => {
  it('permits entry at zero pushups and keeps lifetime reps out of the next day’s power', () => {
    const db = database();
    expect(startDungeon(db, 0, now).state.stats.attack).toBe(25);
    savePushupWorkout(db, workout);
    savePushupWorkout(db, workout);
    expect(getGameSnapshot(db, now)).toMatchObject({ savedPushups: 100, damage: 275, damageMultiplier: 11, today: { pushups: 100, partialReps: 3 } });
    expect(getGameSnapshot(db, tomorrow)).toMatchObject({ savedPushups: 100, damage: 25, damageMultiplier: 1, today: { pushups: 0 } });
  });

  it('never spends training, including historically spent reps, on attacks or retreats', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 4 });
    getHero(db);
    db.update(schema.heroes).set({ pushupUnitsSpent: 400 }).run();
    let run = startDungeon(db, 0, now);
    expect(run.state.stats).toMatchObject({ pushups: 4, attack: 35, damageMultiplier: 1.4 });
    run = nextAttack(db, run);
    expect(run.state.enemyHp).toBe(run.state.dungeon!.enemies[0].health - run.state.impacts![0].amount);
    expect(run.state.impacts![0].amount).toBeGreaterThanOrEqual(28);
    expect(run.state.impacts![0].amount).toBeLessThanOrEqual(42);
    expect(advanceDungeon(db, run.id, run.state.tick - 1, now)).toEqual(run);
    expect(getSavedPushups(db)).toBe(4);
    retreatDungeon(db, run.id);
    retreatDungeon(db, run.id);
    expect(getSavedPushups(db)).toBe(4);
    expect(getHero(db).pushupUnitsSpent).toBe(400);
    expect(startDungeon(db, 0, now).state.stats.pushups).toBe(4);
  });

  it('restores snapshotted power, focus charges, and seeded rolls after reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fitness-power-'));
    const path = join(directory, 'game.db');
    const db = database(path);
    let reopened: Database.Database | undefined;
    try {
      savePushupWorkout(db, { ...workout, validReps: 1 });
      getHero(db);
      giveItem(db, GEAR.restraint_amulet, 'amulet');
      db.update(schema.heroes).set({ focusAttacks: 10 }).run();
      saveRun(db, day, { distanceMeters: 10000, durationSeconds: 4500, steps: 10000 }, 'agility', now);
      let run = nextAttack(db, startDungeon(db, 0, now));
      run = advanceExpedition(db, run, now);
      const before = getGameSnapshot(db, now);
      expect(before.hero).toMatchObject({ pushupUnitsSpent: 0, focusAttacks: 9, combatMeters: { dodge: 0 } });
      db.$client.close();
      reopened = new Database(path);
      const restored = drizzle(reopened, { schema });
      expect(getGameSnapshot(restored, now)).toEqual(before);
      retreatDungeon(restored, run.id);
      expect(startDungeon(restored, 0, now).state).toMatchObject({ stats: { pushups: 1 }, focusAttacks: 9, meters: { dodge: 0 } });
    } finally {
      reopened?.close();
      if (db.$client.open) db.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps fighting beyond the number of pushups, restores entry health on defeat, and allows retry', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    const entry = startDungeon(db, 0, now);
    let run = entry;
    for (let i = 0; i < 100 && run.status === 'active'; i++) run = advanceExpedition(db, run, now);
    expect(run.status).toBe('defeat');
    expect(run.state.attacksMade).toBeGreaterThan(1);
    expect(getGameSnapshot(db, now)).toMatchObject({ currentHealth: entry.state.entryHp, savedPushups: 1, hero: { gold: 0, xp: 0 } });
    expect(startDungeon(db, 0, now).state.stats.attack).toBe(28);
  });

  it('snapshots training until the next expedition while keeping new workouts and quests', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    let run = nextAttack(db, startDungeon(db, 0, now));
    savePushupWorkout(db, { ...workout, sourceKey: 'more-training', validReps: 20 });
    run = nextAttack(db, run);
    expect(run.state.stats).toMatchObject({ pushups: 1, attack: 28 });
    expect(getGameSnapshot(db, now).stats).toMatchObject({ pushups: 21, attack: 78 });
    expect(claimChallenge(db, 'pushups', now)).toBe(true);
    retreatDungeon(db, run.id);
    expect(startDungeon(db, 0, now).state.stats.pushups).toBe(21);
  });

  it.each(['defeat', 'retreated', 'expired'] as const)('rolls back a failed %s checkpoint without losing power', status => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    getHero(db);
    if (status === 'defeat') db.update(schema.heroes).set({ damageDay: day, damageTaken: 99 }).run();
    const run = nextAttack(db, startDungeon(db, 0, now));
    const before = getGameSnapshot(db, now);
    const finish = () => status === 'retreated' ? retreatDungeon(db, run.id)
      : status === 'expired' ? expireBattles(db, tomorrow) : advanceDungeon(db, run.id, run.state.tick, now);
    db.run("CREATE TRIGGER fail_finish BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(finish).toThrow();
    expect(getGameSnapshot(db, now)).toEqual(before);
    db.run('DROP TRIGGER fail_finish');
    finish(); finish();
    expect(getGameSnapshot(db, status === 'expired' ? tomorrow : now)).toMatchObject({ savedPushups: 1,
      hero: { pushupUnitsSpent: 0, gold: 0, xp: 0 }, latestBattle: { status } });
  });

  it('rolls back a failed attack checkpoint including its focus charge', () => {
    const db = database();
    savePushupWorkout(db, workout);
    getHero(db);
    db.update(schema.heroes).set({ focusAttacks: 10 }).run();
    let run = startDungeon(db, 0, now);
    for (let i = 0; i < 3; i++) run = advanceExpedition(db, run, now);
    const before = getGameSnapshot(db, now);
    db.run("CREATE TRIGGER fail_turn BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(() => advanceDungeon(db, run.id, run.state.tick, now)).toThrow();
    expect(getGameSnapshot(db, now)).toEqual(before);
    db.run('DROP TRIGGER fail_turn');
    expect(advanceDungeon(db, run.id, run.state.tick, now)?.state.stats.pushups).toBe(100);
    expect(getHero(db).focusAttacks).toBe(9);
  });
});

describe('gold items', () => {
  it('applies a found amulet bonus only while equipped', () => {
    const db = database();
    const found = giveItem(db, GEAR.restraint_amulet);
    expect(getGameSnapshot(db, now).stats.pushupDamageCoefficient).toBeCloseTo(0.1);
    equipItem(db, found.id, 'amulet');
    expect(getGameSnapshot(db, now).stats.pushupDamageCoefficient).toBeCloseTo(0.11);
    unequipItem(db, 'amulet');
    expect(getGameSnapshot(db, now).stats.pushupDamageCoefficient).toBeCloseTo(0.1);
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

  it('ends focus exactly after ten swings and never refunds it on retreat', () => {
    const db = database();
    savePushupWorkout(db, { ...workout, validReps: 1 });
    getHero(db);
    giveItem(db, GEAR.restraint_amulet, 'amulet');
    db.update(schema.heroes).set({ focusAttacks: 10 }).run();
    saveStepTotal(db, day, 10000);
    let run = startDungeon(db, 0, now);
    for (let i = 0; i < 11; i++) run = nextAttack(db, run);
    expect(getHero(db)).toMatchObject({ pushupUnitsSpent: 0, focusAttacks: 0 });
    retreatDungeon(db, run.id);
    expect(getSavedPushups(db)).toBe(1);
    expect(getHero(db).focusAttacks).toBe(0);
    expect(getGameSnapshot(db, now).stats.pushupDamageCoefficient).toBeCloseTo(0.11);
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
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0004_dungeon_recovery.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0005_pushup_damage.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0006_inventory.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0007_daily_fitness_reset.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0008_camp_expeditions.sql'), 'utf8'));
    const db = drizzle(sqlite, { schema });
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot).toMatchObject({ savedPushups: 12, hero: { gold: 70, xp: 85, swordLevel: 2 },
      latestBattle: { status: 'retreated', state: { gold: 0, xp: 0, attacksMade: 0, stats: { dodgeBps: 0, attackEffects: [] } } } });
    expect(db.select().from(schema.sets).where(eq(schema.sets.sessionId, 1)).get()?.partialReps).toBe(3);
    expect(getGameSnapshot(db, now).savedPushups).toBe(12);
  } finally { sqlite.close(); }
});
