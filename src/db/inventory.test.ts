import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db';
import { giveItem } from '../../test/equipment';
import { GEAR } from '../game/equipment';
import { battleTurn, type BattleState } from '../game/combat';
import { advanceDungeon, expireBattles, getGameSnapshot, getHero, retreatDungeon, savePushupWorkout, startDungeon } from './game';
import { equipItem, getInventory, sellItem, unequipItem } from './inventory';
import { dungeonRuns, dungeonSeeds, heroes, inventoryItems } from './schema';

const now = new Date(2026, 8, 11, 12).getTime();
const databases: ReturnType<typeof createTestDb>[] = [];
function database() { const db = createTestDb(); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
function trained() {
  const db = database();
  savePushupWorkout(db, { sourceKey: 'training', startedAt: now - 60000, endedAt: now, validReps: 100, partialReps: 0 });
  return db;
}
function finish(db: ReturnType<typeof database>, run = startDungeon(db, 0, now)) {
  for (let i = 0; i < 2000 && run.status === 'active'; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
  expect(run.status).not.toBe('active');
  return run;
}

it('converts legacy bonuses once, preserves resources and never regifts sold starters', () => {
  const db = database();
  db.insert(heroes).values({ id: 1, swordLevel: 4, armorLevel: 2, amuletOwned: true, gold: 147, xp: 200, healthPotions: 2 }).run();
  const snapshot = getGameSnapshot(db, now);
  expect(snapshot.inventory).toHaveLength(3);
  expect(snapshot.stats).toMatchObject({ baseDamageMin: 34, baseDamageMax: 44, baseHealth: 150, pushupDamageCoefficient: 0.11 });
  expect(snapshot.hero).toMatchObject({ gold: 147, xp: 200, healthPotions: 2, inventoryVersion: 2 });
  const club = snapshot.inventory.find(item => item.slot === 'weapon')!;
  unequipItem(db, 'weapon'); sellItem(db, club.id);
  expect(getGameSnapshot(db, now).inventory).toHaveLength(2);
  expect(getGameSnapshot(db, now).stats.baseDamageMin).toBe(7);
});

it('rolls back a failed legacy conversion instead of partially gifting items', () => {
  const db = database();
  db.insert(heroes).values({ id: 1, swordLevel: 2 }).run();
  db.run("CREATE TRIGGER fail_conversion BEFORE INSERT ON inventory_items WHEN NEW.slot='armor' BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  expect(() => getHero(db)).toThrow();
  expect(getInventory(db)).toEqual([]);
  expect(db.select().from(heroes).get()?.inventoryVersion).toBe(0);
  db.run('DROP TRIGGER fail_conversion');
  expect(getGameSnapshot(db, now).inventory).toHaveLength(2);
});

it('replaces gear without losing either item and handles duplicate rings independently', () => {
  const db = database();
  const club = giveItem(db, GEAR.root_maul);
  const old = getInventory(db).find(item => item.slot === 'weapon')!;
  equipItem(db, club.id, 'weapon');
  expect(getInventory(db).find(item => item.id === old.id)?.slot).toBeNull();
  const one = giveItem(db, GEAR.copper_ring, 'ring1');
  const two = giveItem(db, GEAR.copper_ring, 'ring2');
  expect(getGameSnapshot(db, now).stats).toMatchObject({ baseDamageMin: 34, baseDamageMax: 50, health: 110 });
  equipItem(db, one.id, 'ring2');
  expect(getInventory(db).find(item => item.id === two.id)?.slot).toBeNull();
  expect(getInventory(db).filter(item => item.slot?.startsWith('ring'))).toHaveLength(1);
  expect(() => equipItem(db, club.id, 'helmet')).toThrow(/fit/);
  expect(() => equipItem(db, -1, 'weapon')).toThrow(/bag/);
  expect(() => sellItem(db, club.id)).toThrow(/Unequip/);
  expect(getGameSnapshot(db, now).stats.baseDamageMin).toBe(32);
});

it('snapshots the equipped weapon class for the whole run, including reload and bare hands', () => {
  const db = database();
  const axe = giveItem(db, Object.values(GEAR).find(item => item.weaponType === 'axe')!);
  equipItem(db, axe.id, 'weapon');
  const run = startDungeon(db, 0, now);
  expect(run.state.weaponType).toBe('axe');
  expect(db.select().from(dungeonRuns).get()?.state.weaponType).toBe('axe');
  expect(battleTurn(JSON.parse(JSON.stringify(run.state))).weaponType).toBe('axe');
  retreatDungeon(db, run.id);
  unequipItem(db, 'weapon');
  expect(startDungeon(db, 0, now).state.weaponType).toBe('fist');
});

it('locks gear during an expedition, keeps its snapshot and rolls back failed sales', () => {
  const db = database();
  const armor = giveItem(db, GEAR.hide_armor);
  const run = startDungeon(db, 0, now);
  expect(() => equipItem(db, armor.id, 'armor')).toThrow(/camp/);
  expect(() => unequipItem(db, 'weapon')).toThrow(/camp/);
  expect(() => sellItem(db, armor.id)).toThrow(/camp/);
  expect(db.select().from(dungeonRuns).get()).toEqual(run);
  retreatDungeon(db, run.id);
  db.run("CREATE TRIGGER fail_sale BEFORE UPDATE ON heroes BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  expect(() => sellItem(db, armor.id)).toThrow();
  expect(getInventory(db).some(item => item.id === armor.id)).toBe(true);
  expect(getHero(db).gold).toBe(0);
  db.run('DROP TRIGGER fail_sale');
  sellItem(db, armor.id);
  expect(getHero(db).gold).toBe(GEAR.hide_armor.sellValue);
  expect(() => sellItem(db, armor.id)).toThrow(/sold/);
});

it('replays the same full defeat after retry and keeps loot and seeds unchanged', () => {
  const db = database();
  const first = finish(db);
  expect(first.status).toBe('defeat');
  expect(first.state.loot).toEqual([]);
  const second = finish(db);
  expect(second.state).toEqual(first.state);
  expect(getInventory(db)).toHaveLength(2);
  expect(db.select().from(dungeonSeeds).get()?.victories).toBe(0);
});

it('retains the seed across midnight expiry and keeps other dungeon counters independent', () => {
  const db = trained();
  getHero(db);
  db.update(heroes).set({ unlockedDungeon: 1 }).run();
  const other = startDungeon(db, 1, now);
  retreatDungeon(db, other.id);
  expect(finish(db).status).toBe('victory');
  const same = startDungeon(db, 1, now);
  expect(same.state.rng).toEqual(other.state.rng);
  const tomorrow = now + 24 * 60 * 60 * 1000;
  expireBattles(db, tomorrow);
  expect(startDungeon(db, 1, tomorrow).state.rng).toEqual(other.state.rng);
  expect(db.select().from(dungeonSeeds).where(eq(dungeonSeeds.dungeonId, 1)).get()?.victories).toBe(0);
});

it('does not reroll on retreat or JSON reload, including dodge and item effects', () => {
  const db = trained();
  const first = startDungeon(db, 0, now);
  let state: BattleState = { ...first.state, stats: { ...first.state.stats, pushups: 0, dodgeBps: 3000,
    attackEffects: [{ id: 'critical', name: 'Critical', trigger: 'onAttack' as const, rateBps: 4500, kind: 'critical' as const, multiplierBps: 20000 }] } };
  for (let i = 0; i < 35 && state.status === 'active'; i++) {
    expect(battleTurn(JSON.parse(JSON.stringify(state)))).toEqual(battleTurn(state));
    state = battleTurn(state);
  }
  retreatDungeon(db, first.id);
  db.update(heroes).set({ combatMeters: { dodge: 9999, effects: { critical: 9999 } } }).run();
  expect(startDungeon(db, 0, now).state).toEqual(first.state);
});

it('banks every pending drop and the guaranteed boss reward once, advancing only this dungeon seed', () => {
  const db = trained();
  const start = startDungeon(db, 0, now);
  const win = finish(db, start);
  expect(win.status).toBe('victory');
  expect(win.state.loot?.some(drop => drop.boss)).toBe(true);
  expect(getInventory(db).filter(item => !item.slot).map(item => item.item)).toEqual(win.state.loot?.map(drop => drop.item));
  const inventory = getInventory(db), hero = getHero(db);
  advanceDungeon(db, win.id, win.state.tick - 1, now);
  advanceDungeon(db, win.id, win.state.tick, now);
  expect(getInventory(db)).toEqual(inventory);
  expect(getHero(db)).toEqual(hero);
  expect(db.select().from(dungeonSeeds).all()).toEqual([{ dungeonId: 0, victories: 1 }]);
  const retry = startDungeon(db, 0, now);
  expect(retry.state.rng?.generation).toBe(1);
  expect(retry.state.rng?.seed).not.toBe(start.state.rng?.seed);
});

it('commits loot, seed and victory together even if the final checkpoint write fails', () => {
  const db = trained();
  let run = startDungeon(db, 0, now);
  for (let i = 0; i < 2000 && battleTurn(run.state).status !== 'victory'; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
  expect(battleTurn(run.state).status).toBe('victory');
  const hero = getHero(db), inventory = getInventory(db);
  db.run("CREATE TRIGGER fail_reward BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  expect(() => advanceDungeon(db, run.id, run.state.tick, now)).toThrow();
  expect(getInventory(db)).toEqual(inventory);
  expect(getHero(db)).toEqual(hero);
  expect(db.select().from(dungeonSeeds).get()?.victories).toBe(0);
  expect(db.select().from(dungeonRuns).where(eq(dungeonRuns.id, run.id)).get()).toEqual(run);
  db.run('DROP TRIGGER fail_reward');
  expect(advanceDungeon(db, run.id, run.state.tick, now)?.status).toBe('victory');
  expect(db.select().from(inventoryItems).all().length).toBeGreaterThan(2);
});
