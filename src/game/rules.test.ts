import { describe, expect, it } from 'vitest';
import { dayStart, fitnessDay, heroStats, localDay, nextMidnight, paceLabel, recentDays, runDodgeBps, validateRun, validateSteps } from './rules';
import { battleTurn, beginBattle, DUNGEONS } from './combat';

const hero = { gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 };
const day = '2026-09-06';

describe('fitness power', () => {
  it('derives damage from permanent gear, not the size of the pushup stockpile', () => {
    expect(heroStats(hero, fitnessDay(day))).toMatchObject({ attack: 25, health: 100, dodgeBps: 0, dailyHealth: 0 });
    expect(heroStats(hero, fitnessDay(day, 1000)).attack).toBe(25);
    const activity = fitnessDay(day, 120);
    expect(activity.pushups).toBe(120);
  });
  it('adds step health to permanent gear and levels', () => {
    expect(heroStats({ ...hero, xp: 250, swordLevel: 2, armorLevel: 1 }, fitnessDay(day, 20, 4, 3000)))
      .toEqual({ level: 3, attack: 33, health: 160, baseAttack: 33, baseHealth: 130, dailyHealth: 30,
        dodgeBps: 0, pushupCostUnits: 100, attackEffects: [] });
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

describe('local calendar days', () => {
  it('uses local dates at midnight and across month/year boundaries', () => {
    const midnight = new Date(2027, 0, 1).getTime();
    expect(localDay(midnight - 1)).toBe('2026-12-31');
    expect(localDay(midnight)).toBe('2027-01-01');
    expect(nextMidnight(midnight - 1)).toBe(midnight);
    expect(dayStart('2027-01-01')).toBe(midnight);
    expect(recentDays(midnight, 3)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });
  it('uses calendar arithmetic for a daylight-saving transition', () => {
    const before = new Date(2026, 2, 8, 12).getTime();
    expect(nextMidnight(before)).toBe(new Date(2026, 2, 9).getTime());
    expect(recentDays(before, 3)).toEqual(['2026-03-06', '2026-03-07', '2026-03-08']);
  });
});

describe('automatic combat', () => {
  it('allows the hero to attack first and prevents dead enemies retaliating', () => {
    const stats = heroStats({ ...hero, swordLevel: 10 }, fitnessDay(day));
    let battle = beginBattle(0, day, stats, stats.health, { pushupUnits: 10000 });
    while (battle.phase === 'travelling') battle = battleTurn(battle);
    battle = battleTurn(battle);
    expect(battle.defeated).toBe(1);
    expect(battle.heroHp).toBe(stats.health);
    expect(battle.turn).toBe('hero');
    expect(battle.gold).toBe(DUNGEONS[0].enemies[0].gold);
  });
  it('ends an untrained attempt with no loot or XP', () => {
    let battle = beginBattle(0, day, heroStats(hero, fitnessDay(day)), 100, { pushupUnits: 10000 });
    for (let i = 0; battle.status === 'active' && i < 1000; i++) battle = battleTurn(battle);
    expect(battle.status).toBe('defeat');
    expect(battle.heroHp).toBe(0);
    expect(battle.gold).toBe(0);
    expect(battle.xp).toBe(0);
    expect(battle.defeated).toBeLessThan(4);
    expect(battleTurn(battle)).toEqual(battle);
  });
  it.each(DUNGEONS.map((d) => d.id))('can clear dungeon %s including its final boss', (id) => {
    let battle = beginBattle(id, day, { ...heroStats(hero, fitnessDay(day)), level: 20, attack: 200, health: 2000 }, 2000, { pushupUnits: 10000 });
    for (let i = 0; battle.status === 'active' && i < 1000; i++) battle = battleTurn(battle);
    expect(battle.status).toBe('victory');
    expect(battle.enemyHp).toBe(0);
    expect(battle.defeated).toBe(4);
    expect(battle.gold).toBe(DUNGEONS[id].enemies.reduce((sum, e) => sum + e.gold, 0));
    expect(battleTurn(battle)).toEqual(battle);
  });
});
