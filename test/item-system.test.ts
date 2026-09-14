import { expect, it } from 'vitest';
import { armorReduction, damageAfterArmor, fitnessDay, heroStats } from '../src/game/rules';
import { equipmentBonuses, GEAR, itemStatsLabel, previewEquipment, rollLoot, startingEquipment, upgradeGear, type GearItem } from '../src/game/equipment';
import { battleTurn, beginBattle } from '../src/game/combat';

const hero = { gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 };

it('previews a ring move without duplicating its bonuses or mutating owned equipment', () => {
  const inventory = [
    { id: 1, slot: 'ring1' as const, item: GEAR.copper_ring },
    { id: 2, slot: 'ring2' as const, item: GEAR.copper_ring },
  ];
  const preview = previewEquipment(inventory, inventory[0], 'ring2');
  expect(preview.map(item => item.slot)).toEqual(['ring2', null]);
  expect(equipmentBonuses(preview).health).toBe(5);
  expect(equipmentBonuses(inventory).health).toBe(10);
  expect(inventory.map(item => item.slot)).toEqual(['ring1', 'ring2']);
  expect(() => previewEquipment(inventory, inventory[0], 'weapon')).toThrow(/fit/);
});
it('reduces damage with diminishing armor returns, rounds once and retains a minimum hit', () => {
  for (const [armor, reduction, damage] of [[0, 0, 40], [25, .2, 32], [100, .5, 20], [300, .75, 10], [10000, .75, 10]]) {
    expect(armorReduction(armor)).toBe(reduction);
    expect(damageAfterArmor(40, armor)).toBe(damage);
  }
  expect(damageAfterArmor(1, 10000)).toBe(1);
  expect(damageAfterArmor(0, 100)).toBe(0);
  expect(damageAfterArmor(20, -5)).toBe(20);
  expect(damageAfterArmor(20, NaN)).toBe(20);
});

it('applies armor to retaliation, damage numbers and logs while preserving old snapshots and dodges', () => {
  const stats = heroStats(hero, fitnessDay('2026-09-11'));
  const battle = { ...beginBattle(0, '2026-09-11', { ...stats, armor: 100 }), phase: 'fighting' as const, turn: 'enemy' as const };
  const hit = battleTurn(battle);
  const damage = Math.round(battle.dungeon!.enemies[0].attack / 2);
  expect(hit.heroHp).toBe(battle.heroHp - damage);
  expect(hit.impacts).toEqual([{ target: 'hero', encounter: 0, kind: 'damage', amount: damage }]);
  expect(hit.log.at(-1)).toContain(`for ${damage}.`);
  const old = battleTurn({ ...battle, stats: { ...stats, armor: undefined } });
  expect(old.heroHp).toBe(battle.heroHp - battle.dungeon!.enemies[0].attack);
  const dodge = battleTurn({ ...battle, stats: { ...battle.stats, dodgeBps: 10000 } });
  expect(dodge.heroHp).toBe(battle.heroHp);
  expect(dodge.impacts?.[0]).toMatchObject({ kind: 'miss', amount: 0 });
});

it('stacks all six modifier types, applies flat damage before training, and resolves criticals once', () => {
  const item: GearItem = { ...GEAR.copper_ring, modifiers: [
    { stat: 'health', value: 10 }, { stat: 'damage', value: 3 }, { stat: 'armor', value: 12 },
    { stat: 'pushup_damage_coefficient', value: .005 }, { stat: 'crit_chance_bps', value: 5000 }, { stat: 'crit_damage_bps', value: 2500 },
  ] };
  const gear = [...startingEquipment(), { slot: 'ring1' as const, item }, { slot: 'ring2' as const, item }];
  const stats = heroStats(hero, fitnessDay('2026-09-11', 10), 10, gear);
  expect(stats).toMatchObject({ baseDamageMin: 26, baseDamageMax: 36, armor: 26, health: 120,
    pushupDamageCoefficient: .11, critChanceBps: 10000, critMultiplierBps: 20000 });
  expect(stats.attackEffects).toHaveLength(1);
  const battle = { ...beginBattle(0, '2026-09-11', stats), phase: 'fighting' as const, enemyHp: 10000 };
  const attack = battleTurn(battle);
  expect(attack.impacts?.[0]).toMatchObject({ critical: true, amount: 130 });
  expect(battleTurn(JSON.parse(JSON.stringify(battle)))).toEqual(attack);
  expect(itemStatsLabel(item)).toContain('+0.5% damage per pushup');
  expect(equipmentBonuses([{ slot: null, item }]).armor).toBe(0);
});

it('rolls plain catalog bases with rarity-specific names and no inherited magical properties', () => {
  const before = JSON.stringify(GEAR);
  const seen = new Set<string>(), types = new Set<string>(), rarities = new Set<string>();
  for (const level of [3, 8, 13]) {
    for (let seed = 0; seed < 1500; seed++) {
      for (const boss of [false, true]) {
        const drops = rollLoot(seed, 1, boss, 0, { level, difficulty: 'mythic', chest: !boss });
        expect(drops).toHaveLength(1);
        for (const drop of drops) {
          seen.add(drop.item.definitionId);
          rarities.add(drop.item.rarity);
          expect(drop.item.itemLevel).toBeGreaterThanOrEqual(level - 1);
          expect(drop.item.itemLevel).toBeLessThanOrEqual(level + 1);
          expect(drop.item.tier).toBe(Math.ceil(level / 5));
          const base = GEAR[drop.item.definitionId];
          expect(base.rarity).toBe('common');
          const affixes = drop.item.modifiers ?? [];
          expect(drop.item.health).toBeUndefined();
          expect(drop.item.attackBonus).toBeUndefined();
          expect(drop.item.coefficientBonus).toBeUndefined();
          expect(drop.item.effects).toBeUndefined();
          if (drop.item.rarity === 'common') {
            expect(affixes).toHaveLength(0);
            expect(drop.item.name).toBe(base.name);
            if (drop.item.kind === 'ring' || drop.item.kind === 'amulet') expect(itemStatsLabel(drop.item)).toBe('No stat bonus');
          } else if (drop.item.rarity === 'uncommon') {
            expect(affixes).toHaveLength(1);
            expect(affixes[0].affix).toMatch(/^of /);
            expect(drop.item.name).toBe(`${base.name} ${affixes[0].affix}`);
          } else {
            expect(affixes).toHaveLength(2);
            expect(new Set(affixes.map(modifier => modifier.stat)).size).toBe(2);
            expect(affixes[0].affix).not.toMatch(/^of /);
            expect(affixes[1].affix).toMatch(/^of /);
            expect(drop.item.name).toBe(`${affixes[0].affix} ${base.name} ${affixes[1].affix}`);
          }
          for (const modifier of affixes) types.add(modifier.stat);
        }
      }
    }
  }
  expect(seen).toEqual(new Set(Object.values(GEAR).filter(item => item.rarity === 'common').map(item => item.definitionId)));
  expect(rarities).toEqual(new Set(['common', 'uncommon', 'rare', 'epic']));
  expect(types.size).toBe(6);
  expect(JSON.stringify(GEAR)).toBe(before);
});

it('fills missing item levels without rerolling or stripping earned version 2 gear', () => {
  const saved: GearItem = { ...GEAR.wooden_club, name: 'My old mighty club', rarity: 'rare', tier: 3,
    damageMin: 999, damageMax: 1200, health: 40, coefficientBonus: .025, sellValue: 123,
    modifiers: [{ stat: 'damage', value: 90, affix: 'of Impact' }],
    effects: [{ id: 'earned-critical', kind: 'critical', name: 'Earned critical', trigger: 'onAttack', rateBps: 1000, multiplierBps: 18000 }],
  };
  const original = JSON.parse(JSON.stringify(saved));
  const upgraded = upgradeGear(saved);
  expect(upgraded).toEqual({ ...saved, itemLevel: 3 });
  expect(upgradeGear(upgraded)).toBe(upgraded);
  expect(saved).toEqual(original);
  expect(upgradeGear({ ...saved, itemLevel: 42 }).itemLevel).toBe(42);
  expect(upgradeGear({ ...saved, definitionId: 'unknown-earned-item', tier: undefined }).itemLevel).toBe(1);
});

it('adds protection to old gear while keeping earned rolls, prices, health and unknown item definitions', () => {
  const legacy: GearItem = { definitionId: 'hide_armor', kind: 'armor', name: 'My old hide', rarity: 'rare', health: 50, sellValue: 32 };
  const updated = upgradeGear(legacy);
  expect(updated).toMatchObject({ ...legacy, version: 2, armor: 12 });
  expect(upgradeGear(updated)).toBe(updated);
  expect(upgradeGear({ ...legacy, definitionId: 'unregistered_old_coat' })).toMatchObject({
    definitionId: 'unregistered_old_coat', health: 50, sellValue: 32, version: 2, armor: undefined,
  });
});
