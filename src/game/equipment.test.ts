import { expect, it } from 'vitest';
import { equipmentBonuses, EQUIPMENT_SLOTS, fitsSlot, GEAR, rollLoot, startingEquipment, type ItemRarity, type LootDifficulty } from './equipment';
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
  expect(loot[0]).toMatchObject({ boss: true, encounter: 4, source: 'enemy' });
  expect(['uncommon', 'rare', 'epic']).toContain(loot[0].item.rarity);
  randomInt(seed, 20, 30);
  expect(rollLoot(seed, 4, true)).toEqual(loot);
  const drops = Array.from({ length: 50 }, (_, i) => rollLoot(seed, i, false));
  expect(drops.some(items => items.length === 1)).toBe(true);
  expect(drops.some(items => items.length === 0)).toBe(true);
});

it('keeps ordinary drops near 20%, with scarce rares and more magic in premium dungeons', () => {
  const samples = 30000;
  const results = (['normal', 'heroic', 'mythic'] as const).map(difficulty => {
    const counts: Record<ItemRarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0 };
    for (let seed = 0; seed < samples; seed++) {
      for (const drop of rollLoot(seed, 2, false, 0, { difficulty, level: 8 })) counts[drop.item.rarity]++;
    }
    const drops = Object.values(counts).reduce((total, count) => total + count, 0);
    expect(drops / samples).toBeGreaterThan(.19);
    expect(drops / samples).toBeLessThan(.21);
    expect(counts.epic / drops).toBeLessThan(.01);
    return { ...counts, drops, magic: 1 - counts.common / drops };
  });
  const [normal, heroic, mythic] = results;
  expect(normal.magic).toBeGreaterThan(.17);
  expect(normal.magic).toBeLessThan(.23);
  expect(normal.rare / normal.drops).toBeGreaterThan(.005);
  expect(normal.rare / normal.drops).toBeLessThan(.025);
  expect(heroic.magic).toBeGreaterThan(.47);
  expect(heroic.magic).toBeLessThan(.53);
  expect(mythic.magic).toBeGreaterThan(.62);
  expect(mythic.magic).toBeLessThan(.68);
  expect(heroic.rare).toBeGreaterThan(normal.rare);
  expect(mythic.rare).toBeGreaterThan(heroic.rare);
});

it.each<LootDifficulty>(['normal', 'heroic', 'mythic'])('guarantees %s boss minimum rarity and one deterministic chest item', difficulty => {
  for (let seed = 0; seed < 500; seed++) {
    const boss = rollLoot(seed, 4, true, 0, { difficulty, level: 12 });
    expect(boss).toHaveLength(1);
    expect(difficulty === 'normal' ? ['uncommon', 'rare', 'epic'] : ['rare', 'epic']).toContain(boss[0].item.rarity);
    const options = { difficulty, level: 12, chest: true };
    const chest = rollLoot(seed, 1, false, 0, options);
    expect(chest).toHaveLength(1);
    expect(chest[0]).toMatchObject({ boss: false, source: 'chest', encounter: 1 });
    expect(rollLoot(seed, 1, false, 0, options)).toEqual(chest);
    expect(chest[0].item.itemLevel).toBeGreaterThanOrEqual(11);
    expect(chest[0].item.itemLevel).toBeLessThanOrEqual(13);
  }
});

it('scales intrinsic power and affixes with item level beyond the old three catalog tiers', () => {
  const low = Array.from({ length: 100 }, (_, seed) => rollLoot(seed, 4, true, 0, { difficulty: 'heroic', level: 12 })[0].item);
  const high = Array.from({ length: 100 }, (_, seed) => rollLoot(seed, 4, true, 0, { difficulty: 'heroic', level: 22 })[0].item);
  expect(low.some(item => item.damageMin !== undefined)).toBe(true);
  expect(low.some(item => item.armor !== undefined)).toBe(true);
  for (let index = 0; index < low.length; index++) {
    const a = low[index], b = high[index];
    expect(b.definitionId).toBe(a.definitionId);
    expect(b.name).toBe(a.name);
    expect(b.itemLevel).toBe(a.itemLevel! + 10);
    if (a.damageMin !== undefined) expect(b.damageMin).toBeGreaterThan(a.damageMin);
    if (a.armor !== undefined) expect(b.armor).toBeGreaterThan(a.armor);
    for (let modifier = 0; modifier < a.modifiers!.length; modifier++) {
      expect(b.modifiers![modifier].stat).toBe(a.modifiers![modifier].stat);
      expect(b.modifiers![modifier].value).toBeGreaterThan(a.modifiers![modifier].value);
    }
  }
});

it('gives epic affixes more power than the same rare roll', () => {
  const upgrades = Array.from({ length: 2000 }, (_, seed) => {
    const rare = rollLoot(seed, 4, true, 0, { difficulty: 'heroic', level: 8 })[0].item;
    const epic = rollLoot(seed, 4, true, 0, { difficulty: 'mythic', level: 8 })[0].item;
    return { rare, epic };
  }).filter(({ rare, epic }) => rare.rarity === 'rare' && epic.rarity === 'epic');
  expect(upgrades.length).toBeGreaterThan(0);
  for (const { rare, epic } of upgrades) {
    expect(epic.name).toBe(rare.name);
    expect(epic.itemLevel).toBe(rare.itemLevel);
    for (let index = 0; index < rare.modifiers!.length; index++) {
      expect(epic.modifiers![index].stat).toBe(rare.modifiers![index].stat);
      expect(epic.modifiers![index].value).toBeGreaterThan(rare.modifiers![index].value);
    }
  }
});

it('normalizes invalid levels and retains the fourth argument as a legacy level fallback', () => {
  for (const level of [NaN, Infinity, -5, 0]) {
    expect([1, 2]).toContain(rollLoot(12, 4, true, 0, { level })[0].item.itemLevel);
  }
  const legacy = rollLoot(12, 4, true, 7);
  expect(legacy).toEqual(rollLoot(12, 4, true, 0, { level: 8 }));
});
