import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db';
import { advanceDungeon, getGameSnapshot, getHero } from './game';
import { getInventory } from './inventory';
import { dungeonRuns, dungeonSeeds, heroes, inventoryItems } from './schema';
import { beginBattle } from '../game/combat';
import { fitnessDay, heroStats } from '../game/rules';

const databases: ReturnType<typeof createTestDb>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });
const oldItem = { definitionId: 'hide_armor', name: 'Old Hide +1', kind: 'armor' as const, rarity: 'uncommon' as const, health: 50, sellValue: 32 };
function fixture() {
  const db = createTestDb(); databases.push(db);
  db.insert(heroes).values({ id: 1, inventoryVersion: 1, gold: 73, damageDay: '2026-09-11', damageTaken: 15 }).run();
  db.insert(inventoryItems).values({ item: oldItem, slot: 'armor', acquiredAt: 123, sourceKey: 'run:old:loot:0' }).run();
  return db;
}

it('upgrades an existing bag atomically, retains health and never rewrites the active battle', () => {
  const db = fixture();
  const now = new Date(2026, 8, 11, 12).getTime();
  const stats = heroStats({ gold: 73, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  delete stats.armor;
  const state = beginBattle(0, '2026-09-11', stats, 85);
  db.insert(dungeonRuns).values({ startedAt: now, status: 'active', state }).run();
  const snapshot = getGameSnapshot(db, now);
  expect(snapshot.hero).toMatchObject({ inventoryVersion: 2, gold: 73, damageTaken: 15 });
  expect(snapshot.stats).toMatchObject({ armor: 12, health: 150 });
  expect(snapshot.currentHealth).toBe(135);
  expect(snapshot.inventory).toHaveLength(1);
  expect(snapshot.inventory[0]).toMatchObject({ acquiredAt: 123, sourceKey: 'run:old:loot:0', item: { ...oldItem, armor: 12, version: 2 } });
  expect(db.select().from(dungeonRuns).get()?.state).toEqual(state);
  expect(getGameSnapshot(db, now).inventory).toEqual(snapshot.inventory);
});

it('rolls back both item conversion and the version marker on a failed write', () => {
  const db = fixture();
  db.run("CREATE TRIGGER fail_item_upgrade BEFORE UPDATE ON inventory_items BEGIN SELECT RAISE(ABORT, 'disk error'); END");
  expect(() => getHero(db)).toThrow(/disk error/);
  expect(db.select().from(heroes).where(eq(heroes.id, 1)).get()?.inventoryVersion).toBe(1);
  expect(getInventory(db)[0].item).toEqual(oldItem);
  db.run('DROP TRIGGER fail_item_upgrade');
  expect(getHero(db).inventoryVersion).toBe(2);
  expect(getInventory(db)[0].item.armor).toBe(12);
});

it('awards late legacy loot with the same stats in the result and in the migrated bag', () => {
  const db = fixture();
  const now = new Date(2026, 8, 11, 12).getTime();
  const stats = heroStats({ gold: 73, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  delete stats.armor;
  const initial = beginBattle(0, '2026-09-11', stats, 85, { seed: 123 });
  const state = { ...initial, encounter: 4, defeated: 4, phase: 'fighting' as const, enemyHp: 1,
    lootPlan: [{ encounter: 4, boss: true, item: oldItem }] };
  db.insert(dungeonSeeds).values({ dungeonId: 0 }).run();
  const run = db.insert(dungeonRuns).values({ startedAt: now, status: 'active', state }).returning().get();
  getHero(db);
  const won = advanceDungeon(db, run.id, 0, now)!;
  expect(won.status).toBe('victory');
  const item = getInventory(db).find(owned => !owned.slot)!.item;
  expect(item).toMatchObject({ ...oldItem, armor: 12, version: 2 });
  expect(won.state.loot?.[0].item).toEqual(item);
  expect(won.state.stats).toEqual(stats);
});
