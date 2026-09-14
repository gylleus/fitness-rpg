import { describe, expect, it } from 'vitest';
import { battleDungeon, battleTurn, beginBattle, DUNGEONS, generateDungeonMap, resolveChest, type BattleState } from './combat';
import { fitnessDay, heroStats } from './rules';

const day = '2026-09-15';
const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay(day));
const strongStats = { ...stats, health: 10000, baseDamageMin: 10000, baseDamageMax: 10000 };
const restore = (battle: BattleState): BattleState => JSON.parse(JSON.stringify(battle));

function nextChest(battle: BattleState) {
  for (let tick = 0; tick < 100 && battle.status === 'active' && battle.phase !== 'chest'; tick++) battle = battleTurn(battle);
  expect(battle.phase).toBe('chest');
  return battle;
}

describe('camp dungeon generation', () => {
  it('generates a stable map with two free normal routes and both premium difficulties', () => {
    const offers = generateDungeonMap(7, 12);
    expect(generateDungeonMap(7, 12)).toEqual(offers);
    expect(offers.map(offer => [offer.difficulty, offer.stepCost, offer.enemies.length])).toEqual([
      ['normal', 0, 5], ['normal', 0, 5], ['heroic', 1000, 8], ['mythic', 5000, 12],
    ]);
    expect(new Set(offers.map(offer => offer.id)).size).toBe(4);
    expect(offers.every(offer => offer.mapGeneration === 12)).toBe(true);
    expect(generateDungeonMap(1, 0)[0].biomeId).toBe('wetlands');
  });

  it('refreshes offer identities and encounter rolls with each map generation', () => {
    const maps = Array.from({ length: 100 }, (_, generation) => generateDungeonMap(10, generation));
    expect(new Set(maps.flat().map(offer => offer.offerId)).size).toBe(400);
    expect(new Set(maps.flat().map(offer => offer.seed)).size).toBe(400);
    expect(new Set(maps.map(map => map.map(offer => offer.id).join(','))).size).toBeGreaterThan(10);
  });

  it.each([1, 8, 30])('keeps levels near hero level %i, premium monsters longer, and bosses intact', level => {
    let chestCount = 0;
    for (let generation = 0; generation < 100; generation++) {
      const offers = generateDungeonMap(level, generation);
      for (const offer of offers) {
        expect(offer.level).toBeGreaterThanOrEqual(Math.max(1, level - 3));
        expect(offer.level).toBeLessThanOrEqual(level);
        if (offer.difficulty !== 'normal') expect(offer.level).toBe(level);
        for (const encounter of offer.chestEncounters ?? []) {
          expect(encounter).toBeGreaterThan(0);
          expect(encounter).toBeLessThan(offer.enemies.length - 1);
          chestCount++;
        }
        const template = DUNGEONS[offer.id];
        expect(offer.enemies.at(-1)?.name).toBe(template.enemies.at(-1)?.name);
        expect(offer.enemies.every(enemy => enemy.health > 0 && enemy.attack > 0)).toBe(true);
      }
      const monsterCounts = offers.map(offer => offer.enemies.length - (offer.chestEncounters?.length ?? 0));
      expect(monsterCounts[2]).toBeGreaterThan(Math.max(monsterCounts[0], monsterCounts[1]));
      expect(monsterCounts[3]).toBeGreaterThan(monsterCounts[2]);
      expect(offers[3].enemies.at(-1)!.health).toBeGreaterThan(offers[2].enemies.at(-1)!.health);
      expect(offers[3].enemies.at(-1)!.attack).toBeGreaterThan(offers[2].enemies.at(-1)!.attack);
    }
    expect(chestCount).toBeGreaterThan(50);
    expect(chestCount).toBeLessThan(250);
  });

  it('normalizes different biome bosses to dungeon level and preserves source rosters', () => {
    const originals = JSON.parse(JSON.stringify(DUNGEONS));
    const offers = generateDungeonMap(1, 0);
    expect(offers[0].enemies.at(-1)!.health).toBe(offers[1].enemies.at(-1)!.health);
    const stronger = generateDungeonMap(10, 0);
    expect(stronger[2].enemies[0].health).toBeGreaterThan(offers[2].enemies[0].health);
    offers[0].enemies[0].health = 1;
    expect(DUNGEONS).toEqual(originals);
  });

  it('requires training to finish an introductory normal dungeon', () => {
    const dungeon = { ...generateDungeonMap(1, 0)[0], chestEncounters: [] };
    let battle = beginBattle(dungeon.id, day, stats, stats.health, { dungeon });
    for (let tick = 0; tick < 1000 && battle.status === 'active'; tick++) battle = battleTurn(battle);
    expect(battle.status).toBe('defeat');
  });

  it('rejects invalid map inputs', () => {
    expect(() => generateDungeonMap(0, 0)).toThrow();
    expect(() => generateDungeonMap(NaN, 0)).toThrow();
    expect(() => generateDungeonMap(1, -1)).toThrow();
  });
});

describe('saved encounters and chests', () => {
  const chestRun = () => {
    const dungeon = { ...generateDungeonMap(1, 0)[0], chestEncounters: [1] };
    return beginBattle(dungeon.id, day, strongStats, strongStats.health, { dungeon });
  };

  it('snapshots the offer and loot before play without changing legacy template calls', () => {
    const dungeon = generateDungeonMap(4, 0)[2];
    const battle = beginBattle(dungeon.id, day, strongStats, strongStats.health, { dungeon });
    expect(battle.rulesVersion).toBe(4);
    expect(battle.dungeon).toEqual(dungeon);
    expect(battle.rng?.seed).toBe(dungeon.seed);
    const saved = restore(battle);
    dungeon.enemies[0].health = 1;
    dungeon.chestEncounters?.push(0);
    expect(battle).toEqual(saved);
    const legacy = beginBattle(0, day, stats);
    expect(legacy.rulesVersion).toBe(2);
    expect(legacy.dungeon).toEqual(DUNGEONS[0]);
    expect(battleDungeon({ ...legacy, dungeon: undefined }).enemies[0].name).toBe('Moss Slime');
  });

  it('pauses before opening and reveals saved contents only once, including across reloads', () => {
    const chest = nextChest(chestRun());
    const earned = chest.loot ?? [];
    const contents = chest.lootPlan!.filter(drop => drop.encounter === chest.encounter);
    expect(contents).toHaveLength(1);
    expect(earned.some(drop => drop.encounter === chest.encounter)).toBe(false);
    expect(battleTurn(chest)).toBe(chest);
    expect(resolveChest(chest, 'continue')).toBe(chest);
    const opened = resolveChest(chest, 'open');
    expect(opened.phase).toBe('chest-reveal');
    expect(opened.loot).toEqual([...earned, ...contents]);
    expect(opened.defeated).toBe(chest.defeated);
    expect(opened.gold).toBe(chest.gold);
    expect(opened.xp).toBe(chest.xp);
    expect(opened.heroHp).toBe(chest.heroHp);
    expect(opened.rng).toEqual(chest.rng);
    expect(battleTurn(opened)).toBe(opened);
    expect(resolveChest(opened, 'open')).toBe(opened);
    expect(resolveChest(opened, 'skip')).toBe(opened);
    expect(resolveChest(restore(chest), 'open')).toEqual(opened);
    expect(resolveChest(restore(opened), 'open')).toEqual(opened);
    const continued = resolveChest(opened, 'continue');
    expect(continued.phase).toBe('travelling');
    expect(continued.encounter).toBe(chest.encounter + 1);
    expect(continued.loot).toEqual(opened.loot);
    expect(resolveChest(continued, 'continue')).toBe(continued);
  });

  it('can skip a chest without fighting its replaced enemy or receiving its contents', () => {
    const chest = nextChest(chestRun());
    const skipped = resolveChest(chest, 'skip');
    expect(skipped.encounter).toBe(2);
    expect(skipped.defeated).toBe(1);
    expect(skipped.loot).toEqual(chest.loot);
    expect(skipped.heroHp).toBe(chest.heroHp);
    expect(skipped.attacksMade).toBe(chest.attacksMade);
    let battle = skipped;
    for (let tick = 0; tick < 1000 && battle.status === 'active'; tick++) battle = battleTurn(battle);
    expect(battle.status).toBe('victory');
    expect(battle.defeated).toBe(4);
    expect(battle.loot!.filter(drop => drop.boss)).toHaveLength(1);
    expect(battle.loot!.some(drop => drop.encounter === chest.encounter)).toBe(false);
    expect(resolveChest(battle, 'open')).toBe(battle);
  });

  it('never allows a supplied chest index to replace the boss', () => {
    const dungeon = { ...generateDungeonMap(1, 0)[0], chestEncounters: [-1, 1, 1, 4, 5] };
    const battle = beginBattle(dungeon.id, day, strongStats, strongStats.health, { dungeon });
    expect(battle.dungeon!.chestEncounters).toEqual([1]);
    expect(battle.lootPlan!.filter(drop => drop.boss)).toHaveLength(1);
  });
});
