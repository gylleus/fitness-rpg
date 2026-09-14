import { describe, expect, it } from 'vitest';
import { attackPower, dayStart, fitnessDay, heroStats, localDay, nextDailyReset, paceLabel, pushupPower, recentDays, runDodgeBps, validateRun, validateSteps } from './rules';
import { startingEquipment } from './equipment';
import { battleTurn, beginBattle, DUNGEONS } from './combat';

const hero = { gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 };
const day = '2026-09-06';

describe('fitness power', () => {
  it('multiplies base damage by one plus the configurable bonus per pushup', () => {
    expect(heroStats(hero, fitnessDay(day))).toMatchObject({ attack: 25, health: 100, dodgeBps: 0, dailyHealth: 0 });
    expect(heroStats(hero, fitnessDay(day, 10))).toMatchObject({ attack: 50, baseAttack: 25, pushupDamageCoefficient: 0.1, damageMultiplier: 2 });
    expect(heroStats(hero, fitnessDay(day, 20)).attack).toBe(75);
    expect(pushupPower(40, 20, 0.15)).toEqual({ damage: 160, multiplier: 4 });
    expect(attackPower(heroStats({ ...hero, amuletOwned: true }, fitnessDay(day, 10), 10, startingEquipment(0, 0, true)), 1).damage).toBe(58);
    const activity = fitnessDay(day, 120);
    expect(activity.pushups).toBe(120);
  });
  it('adds step health to permanent gear and levels', () => {
    expect(heroStats({ ...hero, xp: 250, swordLevel: 2, armorLevel: 1 }, fitnessDay(day, 20, 4, 3000), 20, startingEquipment(2, 1)))
      .toEqual({ level: 3, attack: 99, health: 160, baseAttack: 33, baseDamageMin: 28, baseDamageMax: 38, baseHealth: 130, dailyHealth: 30,
        armor: 10, critChanceBps: 0, critMultiplierBps: 15000,
        dodgeBps: 0, pushups: 20, pushupDamageCoefficient: 0.1, damageMultiplier: 3, attackEffects: [] });
  });
  it('awards running dodge without multiplying or double-counting health', () => {
    const activity = fitnessDay(day, 0, 0, 6000, [{ distanceMeters: 2000, durationSeconds: 900, steps: 2000 }]);
    expect(activity.steps).toBe(6000);
    expect(activity.agilityBps).toBe(400);
    expect(heroStats(hero, activity)).toMatchObject({ dailyHealth: 60, dodgeBps: 400 });
  });
  it('weights distance by bounded pace and caps daily dodge at 30%', () => {
    expect(runDodgeBps({ distanceMeters: 5000, durationSeconds: 2250 })).toBe(1000);
    expect(runDodgeBps({ distanceMeters: 5000, durationSeconds: 1500 })).toBe(1500);
    expect(runDodgeBps({ distanceMeters: 5000, durationSeconds: 900 })).toBe(1500);
    expect(runDodgeBps({ distanceMeters: 20000, durationSeconds: 9000 })).toBe(3000);
    expect(runDodgeBps({ distanceMeters: 0, durationSeconds: 600 })).toBe(0);
    expect(runDodgeBps({ distanceMeters: 1000, durationSeconds: 0 })).toBe(0);
    expect(runDodgeBps({ distanceMeters: NaN, durationSeconds: 600 })).toBe(0);
  });
  it('uses each run’s pace and earns agility even while native steps are pending', () => {
    const activity = fitnessDay(day, 0, 0, 0, [
      { distanceMeters: 5000, durationSeconds: 2250, steps: 0 },
      { distanceMeters: 5000, durationSeconds: 1500, steps: 0 },
    ]);
    expect(activity.steps).toBe(0);
    expect(activity.agilityBps).toBe(2500);
    expect(heroStats(hero, activity).dailyHealth).toBe(0);
    const capped = fitnessDay(day, 0, 0, 0, Array(5).fill({ distanceMeters: 5000, durationSeconds: 2250, steps: 6000 }));
    expect(capped.steps).toBe(30000);
    expect(capped.agilityBps).toBe(3000);
  });
  it('formats pace correctly across a rounded minute', () => {
    expect(paceLabel(1000, 359.9)).toBe('6:00');
    expect(paceLabel(5000, 1500)).toBe('5:00');
    expect(paceLabel(0, 0)).toBe('—');
  });
  it.each([-1, 2.5, NaN, Infinity, 200001])('rejects an invalid step count: %s', (steps) => {
    expect(() => validateSteps(steps)).toThrow();
  });
  it.each([
    { distanceMeters: NaN, durationSeconds: 600, steps: 1000 },
    { distanceMeters: 1000, durationSeconds: 0, steps: 1000 },
    { distanceMeters: 1000, durationSeconds: Infinity, steps: 1000 },
    { distanceMeters: 1000, durationSeconds: 60, steps: 1000 },
    { distanceMeters: 1000, durationSeconds: 600, steps: 0 },
  ])('rejects invalid run data: %j', (run) => { expect(() => validateRun(run)).toThrow(); });
});

describe('local fitness days', () => {
  it('resets at exactly 5 AM across month/year boundaries, retaining power through midnight', () => {
    const reset = new Date(2027, 0, 1, 5).getTime();
    expect(localDay(new Date(2027, 0, 1))).toBe('2026-12-31');
    expect(localDay(reset - 1)).toBe('2026-12-31');
    expect(localDay(reset)).toBe('2027-01-01');
    expect(nextDailyReset(reset - 1)).toBe(reset);
    expect(nextDailyReset(reset)).toBe(new Date(2027, 0, 2, 5).getTime());
    expect(dayStart('2027-01-01')).toBe(reset);
    expect(recentDays(reset - 1, 3)).toEqual(['2026-12-29', '2026-12-30', '2026-12-31']);
    expect(recentDays(reset, 3)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });
  it.each([[2, 8], [2, 29], [9, 25], [10, 1]])('uses local calendar arithmetic through DST on month %i day %i', (month, date) => {
    // Covers European and US spring/fall transitions when run in those timezones.
    const before = new Date(2026, month, date - 1, 5).getTime();
    const reset = new Date(2026, month, date, 5).getTime();
    expect(nextDailyReset(before)).toBe(reset);
    expect(localDay(new Date(2026, month, date, 4, 59))).toBe(localDay(before));
    expect(recentDays(reset - 1, 2)).toEqual([localDay(new Date(2026, month, date - 2, 5)), localDay(before)]);
    const elapsedHours = (reset - before) / 3_600_000;
    const offsetChange = (new Date(reset).getTimezoneOffset() - new Date(before).getTimezoneOffset()) / 60;
    expect(elapsedHours).toBe(24 + offsetChange);
  });
});

describe('automatic combat', () => {
  it('allows the hero to attack first and prevents dead enemies retaliating', () => {
    const stats = heroStats(hero, fitnessDay(day), 0, startingEquipment(10));
    let battle = beginBattle(0, day, stats, stats.health);
    while (battle.attacksMade === 0) battle = battleTurn(battle);
    expect(battle.defeated).toBe(1);
    expect(battle.heroHp).toBe(stats.health);
    expect(battle.turn).toBe('hero');
    expect(battle.gold).toBe(DUNGEONS[0].enemies[0].gold);
  });
  it('ends an untrained attempt with no loot or XP', () => {
    let battle = beginBattle(0, day, heroStats(hero, fitnessDay(day)), 100);
    for (let i = 0; battle.status === 'active' && i < 1000; i++) battle = battleTurn(battle);
    expect(battle.status).toBe('defeat');
    expect(battle.heroHp).toBe(0);
    expect(battle.gold).toBe(0);
    expect(battle.xp).toBe(0);
    expect(battle.defeated).toBeLessThan(4);
    expect(battleTurn(battle)).toEqual(battle);
  });
  it.each(DUNGEONS.map((d) => d.id))('can clear dungeon %s including its final boss', (id) => {
    let battle = beginBattle(id, day, { ...heroStats(hero, fitnessDay(day)), level: 20, attack: 200, baseAttack: 200, health: 2000 }, 2000);
    for (let i = 0; battle.status === 'active' && i < 1000; i++) battle = battleTurn(battle);
    expect(battle.status).toBe('victory');
    expect(battle.enemyHp).toBe(0);
    expect(battle.defeated).toBe(DUNGEONS[id].enemies.length);
    expect(battle.gold).toBe(DUNGEONS[id].enemies.reduce((sum, e) => sum + e.gold, 0));
    expect(battleTurn(battle)).toEqual(battle);
  });
});
