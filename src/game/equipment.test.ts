import { expect, it } from 'vitest';
import { equipmentBonuses, EQUIPMENT_SLOTS, fitsSlot, GEAR, rollLoot, startingEquipment } from './equipment';
import { dungeonSeed, randomInt } from './random';

it('converts earned upgrades into items without losing their bonuses', () => {
  const items = startingEquipment(4, 3, true);
  expect(equipmentBonuses(items)).toMatchObject({ damageMin: 32, damageMax: 42, health: 60, coefficientBonus: 0.01 });
  expect(equipmentBonuses([])).toMatchObject({ damageMin: 5, damageMax: 9 });
});
it('has seven exclusive slots, accepts rings in either hand and ignores bag items', () => {
  expect(EQUIPMENT_SLOTS).toHaveLength(7);
  expect(fitsSlot(GEAR.copper_ring, 'ring1')).toBe(true);
  expect(fitsSlot(GEAR.copper_ring, 'ring2')).toBe(true);
  expect(fitsSlot(GEAR.iron_club, 'armor')).toBe(false);
  expect(equipmentBonuses([{ item: GEAR.root_maul, slot: null }]).damageMin).toBe(5);
});
it('replays bounded integer rolls, includes both endpoints and retains state through JSON', () => {
  // Fixed vector protects saved sequences against accidental RNG changes.
  expect(randomInt(0, 0, 0xffffffff)).toEqual({ state: 1013904223, value: 1013904223 });
  let state = dungeonSeed(0, 0);
  const rolls: number[] = [];
  for (let i = 0; i < 500; i++) { const draw = randomInt(state, 20, 30); state = draw.state; rolls.push(draw.value); }
  expect(new Set(rolls)).toEqual(new Set(Array.from({ length: 11 }, (_, i) => i + 20)));
  expect(randomInt(JSON.parse(JSON.stringify(state)), 20, 30)).toEqual(randomInt(state, 20, 30));
  expect(dungeonSeed(0, 1)).not.toBe(dungeonSeed(0, 0));
  expect(dungeonSeed(1, 0)).not.toBe(dungeonSeed(0, 0));
  expect(() => randomInt(state, 30, 20)).toThrow();
});
it('guarantees a boss item, permits enemy drops and reproduces loot independently of combat rolls', () => {
  const seed = dungeonSeed(0, 0);
  const loot = rollLoot(seed, 4, true);
  expect(loot).toHaveLength(1);
  expect(loot[0]).toMatchObject({ boss: true, encounter: 4, item: { rarity: 'rare' } });
  randomInt(seed, 20, 30);
  expect(rollLoot(seed, 4, true)).toEqual(loot);
  const drops = Array.from({ length: 50 }, (_, i) => rollLoot(seed, i, false));
  expect(drops.some(items => items.length === 1)).toBe(true);
  expect(drops.some(items => items.length === 0)).toBe(true);
});
