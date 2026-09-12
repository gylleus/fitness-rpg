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

it('makes every catalog definition reachable within its tier and snapshots rolled affixes without mutation', () => {
  const before = JSON.stringify(GEAR);
  const seen = new Set<string>(), types = new Set<string>();
  for (let dungeon = 0; dungeon < 3; dungeon++) {
    for (let seed = 0; seed < 6000; seed++) {
      for (const boss of [false, true]) {
        const drops = rollLoot(seed, 1, boss, dungeon);
        if (boss) expect(drops).toHaveLength(1);
        for (const drop of drops) {
          seen.add(drop.item.definitionId);
          expect(drop.item.tier).toBe(dungeon + 1);
          const affixes = drop.item.modifiers?.filter(modifier => modifier.affix) ?? [];
          if (boss) {
            expect(drop.item.rarity).toBe('rare');
            expect(affixes).toHaveLength(2);
            expect(new Set(affixes.map(modifier => modifier.stat)).size).toBe(2);
          }
          for (const modifier of affixes) types.add(modifier.stat);
        }
      }
    }
  }
  expect(seen).toEqual(new Set(Object.keys(GEAR)));
  expect(types.size).toBe(6);
  expect(JSON.stringify(GEAR)).toBe(before);
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
