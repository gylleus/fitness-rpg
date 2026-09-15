import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../../test/db';
import { battleDungeon, battleTurn } from '../game/combat';
import { localDay } from '../game/rules';
import { getInventory } from './inventory';
import { advanceDungeon, getDungeonMap, getGameSnapshot, getHero, getTravelSteps,
  resolveDungeonChest, retreatDungeon, savePushupWorkout, saveStepTotal, startDungeon } from './game';
import * as schema from './schema';
import journal from './migrations/meta/_journal.json';

const now = new Date(2026, 8, 15, 12).getTime(), day = localDay(now);
const databases: ReturnType<typeof createTestDb>[] = [];
function database() { const db = createTestDb(); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) if (db.$client.open) db.$client.close(); });
function train(db: ReturnType<typeof database>) {
  savePushupWorkout(db, { sourceKey: 'training', startedAt: now - 60000, endedAt: now, validReps: 100, partialReps: 0 });
}
function tick(db: ReturnType<typeof database>, run: ReturnType<typeof startDungeon>) {
  return run.state.phase === 'chest' ? resolveDungeonChest(db, run.id, run.state.tick, 'open', now)!
    : run.state.phase === 'chest-reveal' ? resolveDungeonChest(db, run.id, run.state.tick, 'continue', now)!
      : advanceDungeon(db, run.id, run.state.tick, now)!;
}

describe('camp map and daily travel steps', () => {
  it('offers all difficulties without chapter unlocks, charges once, and preserves fitness totals', () => {
    const db = database();
    const map = getDungeonMap(db);
    expect(map.offers.map(offer => offer.difficulty)).toEqual(['normal', 'normal', 'heroic', 'mythic']);
    const heroic = map.offers.find(offer => offer.difficulty === 'heroic')!;
    expect(() => startDungeon(db, heroic.offerId, now)).toThrow(/1,000 travel steps/);
    expect(db.select().from(schema.dungeonRuns).all()).toEqual([]);
    saveStepTotal(db, day, 1500);
    const run = startDungeon(db, heroic.offerId, now);
    expect(startDungeon(db, heroic.offerId, now)).toEqual(run);
    expect(getGameSnapshot(db, now)).toMatchObject({ today: { steps: 1500 }, travelSteps: { earned: 1500, spent: 1000, available: 500 } });
    retreatDungeon(db, run.id);
    expect(getTravelSteps(db, day).spent).toBe(1000);
    expect(() => startDungeon(db, heroic.offerId, now)).toThrow(/500 available/);
    expect(startDungeon(db, map.offers[0].offerId, now).state.dungeon?.difficulty).toBe('normal');
  });

  it('retains spending after repeated syncs, step corrections, retreat and daily rollover', () => {
    const db = database();
    saveStepTotal(db, day, 6000);
    const offer = getDungeonMap(db).offers.find(offer => offer.difficulty === 'mythic')!;
    const run = startDungeon(db, offer.offerId, now);
    retreatDungeon(db, run.id);
    saveStepTotal(db, day, 6000);
    expect(getTravelSteps(db, day)).toEqual({ bonus: 0, earned: 6000, spent: 5000, available: 1000 });
    // Native providers overwrite activity totals, never the spending ledger.
    db.update(schema.activityDays).set({ nativeSteps: 4500 }).where(eq(schema.activityDays.day, day)).run();
    expect(getTravelSteps(db, day).available).toBe(0);
    db.update(schema.activityDays).set({ nativeSteps: 7000 }).where(eq(schema.activityDays.day, day)).run();
    expect(getTravelSteps(db, day).available).toBe(2000);
    const reset = new Date(2026, 8, 16, 5).getTime();
    expect(getGameSnapshot(db, reset - 1).travelSteps.spent).toBe(5000);
    expect(getGameSnapshot(db, reset).travelSteps).toEqual({ bonus: 0, earned: 0, spent: 0, available: 0 });
    expect(getDungeonMap(db).offers).toContainEqual(offer);
  });

  it('does not convert extra steps into health, damage, armor or dodge', () => {
    const db = database();
    const before = getGameSnapshot(db, now);
    saveStepTotal(db, day, 20000);
    const after = getGameSnapshot(db, now);
    expect(after.stats).toEqual(before.stats);
    expect(after.currentHealth).toEqual(before.currentHealth);
    expect(after.travelSteps.available).toBe(20000);
  });

  it('rolls back the entry charge if inserting the expedition fails', () => {
    const db = database();
    saveStepTotal(db, day, 1000);
    const offer = getDungeonMap(db).offers.find(offer => offer.difficulty === 'heroic')!;
    db.run("CREATE TRIGGER fail_entry BEFORE INSERT ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(() => startDungeon(db, offer.offerId, now)).toThrow(/disk error/);
    expect(getTravelSteps(db, day)).toEqual({ bonus: 0, earned: 1000, spent: 0, available: 1000 });
    expect(db.select().from(schema.dungeonRuns).all()).toEqual([]);
  });

  it('refreshes every offer at the resulting hero level exactly once on victory', () => {
    const db = database(); train(db);
    const before = getDungeonMap(db);
    let run = startDungeon(db, before.offers[0].offerId, now);
    for (let i = 0; run.status === 'active' && i < 1000; i++) run = tick(db, run);
    expect(run.status).toBe('victory');
    const after = getDungeonMap(db), snapshot = getGameSnapshot(db, now);
    expect(after.generation).toBe(before.generation + 1);
    expect(after.offers.every(offer => !before.offers.some(old => old.offerId === offer.offerId))).toBe(true);
    for (const offer of after.offers) expect(offer.level).toBeLessThanOrEqual(snapshot.stats.level);
    for (const offer of after.offers.filter(offer => offer.difficulty !== 'normal')) expect(offer.level).toBe(snapshot.stats.level);
    expect(run.state.loot?.find(drop => drop.boss)?.item.rarity).not.toBe('common');
    expect(() => startDungeon(db, before.offers[0].offerId, now)).toThrow(/no longer available/);
    advanceDungeon(db, run.id, run.state.tick, now);
    expect(getGameSnapshot(db, now)).toEqual(snapshot);
  });

  it('rolls back map refresh, items, gold and XP if the victory checkpoint fails', () => {
    const db = database(); train(db);
    let run = startDungeon(db, 0, now);
    for (let i = 0; battleTurn(run.state).status !== 'victory' && i < 1000; i++) run = tick(db, run);
    expect(battleTurn(run.state).status).toBe('victory');
    const map = getDungeonMap(db), hero = getHero(db), inventory = getInventory(db);
    db.run("CREATE TRIGGER fail_win BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    expect(() => advanceDungeon(db, run.id, run.state.tick, now)).toThrow(/disk error/);
    expect(getDungeonMap(db)).toEqual(map);
    expect(getHero(db)).toEqual(hero);
    expect(getInventory(db)).toEqual(inventory);
    expect(db.select().from(schema.dungeonRuns).get()).toEqual(run);
  });

  it('pauses a chest before opening, reveals once, and survives stale ticks and reloading', () => {
    const db = database(); train(db);
    const start = startDungeon(db, 0, now);
    // Put a chest in the next ordinary position to exercise the saved action path.
    const dungeon = { ...battleDungeon(start.state), chestEncounters: [0] };
    const chestItem = { encounter: 0, boss: false, item: getInventory(db)[0].item };
    const state = { ...start.state, dungeon, lootPlan: [chestItem, ...(start.state.lootPlan ?? []).filter(drop => drop.encounter !== 0)] };
    db.update(schema.dungeonRuns).set({ state }).where(eq(schema.dungeonRuns.id, start.id)).run();
    let run: ReturnType<typeof startDungeon> = { ...start, state };
    for (let i = 0; run.state.phase !== 'chest' && i < 10; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
    expect(run.state.phase).toBe('chest');
    expect(run.state.loot).toEqual([]);
    expect(advanceDungeon(db, run.id, run.state.tick, now)).toEqual(run);
    const opened = resolveDungeonChest(db, run.id, run.state.tick, 'open', now)!;
    expect(opened.state.phase).toBe('chest-reveal');
    expect(opened.state.loot).toEqual([chestItem]);
    expect(resolveDungeonChest(db, run.id, run.state.tick, 'open', now)).toEqual(opened);
    expect(resolveDungeonChest(db, run.id, opened.state.tick, 'open', now)).toEqual(opened);
    expect(getInventory(db)).toHaveLength(2);
    expect(getGameSnapshot(db, now).latestBattle).toEqual(opened);
    const continued = resolveDungeonChest(db, run.id, opened.state.tick, 'continue', now)!;
    expect(continued.state.encounter).toBe(1);
    expect(continued.state.loot).toEqual([chestItem]);
    expect(continued.state.heroHp).toBe(start.state.heroHp);
    retreatDungeon(db, run.id);
    expect(getInventory(db)).toHaveLength(2);
    expect(getDungeonMap(db).generation).toBe(0);
  });

  it('keeps map, spending, and paid battle snapshots across a database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fitness-camp-'));
    const path = join(directory, 'game.db');
    const db = createTestDb(path);
    let reopened: Database.Database | undefined;
    try {
      saveStepTotal(db, day, 6000);
      const map = getDungeonMap(db);
      const run = startDungeon(db, map.offers[3].offerId, now);
      db.$client.close();
      reopened = new Database(path);
      const restored = drizzle(reopened, { schema });
      expect(getDungeonMap(restored)).toEqual(map);
      expect(getGameSnapshot(restored, now)).toMatchObject({ latestBattle: run, travelSteps: { spent: 5000, available: 1000 } });
      expect(startDungeon(restored, map.offers[3].offerId, now)).toEqual(run);
      expect(getTravelSteps(restored, day).spent).toBe(5000);
    } finally {
      if (db.$client.open) db.$client.close();
      reopened?.close(); rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds the economy tables without rewriting existing fitness or earned gear', () => {
    const sqlite = new Database(':memory:');
    try {
      for (const entry of journal.entries.filter(entry => entry.idx < 8)) sqlite.exec(readFileSync(join(__dirname, `migrations/${entry.tag}.sql`), 'utf8'));
      sqlite.exec("INSERT INTO heroes(id, gold, xp) VALUES(1, 83, 720); INSERT INTO activity_days(day, entered_steps) VALUES('2026-09-15', 5000);");
      const item = { definitionId: 'old_ring', name: 'My earned ring', kind: 'ring', rarity: 'rare', sellValue: 73, health: 12 };
      sqlite.prepare('INSERT INTO inventory_items(item, acquired_at, source_key) VALUES(?, 123, ?)').run(JSON.stringify(item), 'old-loot');
      const before = sqlite.prepare('SELECT * FROM inventory_items').all();
      sqlite.exec(readFileSync(join(__dirname, 'migrations/0008_camp_expeditions.sql'), 'utf8'));
      expect(sqlite.prepare('SELECT * FROM inventory_items').all()).toEqual(before);
      expect(sqlite.prepare('SELECT gold,xp FROM heroes').get()).toEqual({ gold: 83, xp: 720 });
      expect(sqlite.prepare('SELECT entered_steps FROM activity_days').get()).toEqual({ entered_steps: 5000 });
    } finally { sqlite.close(); }
  });
});
