import { describe, expect, it, vi } from 'vitest';
import { advanceMeter, emptyCombatMeters, resolveAttack, type AttackEffect } from './attacks';
import { beginBattle, battleTurn } from './combat';
import { fitnessDay, heroStats } from './rules';

const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-06'));

describe('deterministic attacks', () => {
  it.each([[2000, [5, 10, 15, 20]], [1500, [7, 14, 20]], [0, []], [10000, Array.from({ length: 20 }, (_, i) => i + 1)]])
  ('distributes a %s basis-point rate exactly without RNG', (rate, expected) => {
    const random = vi.spyOn(Math, 'random');
    let meter = 0;
    const hits = [];
    for (let i = 1; i <= 20; i++) {
      const next = advanceMeter(meter, rate as number);
      meter = next.meter;
      if (next.triggered) hits.push(i);
    }
    expect(hits).toEqual(expected);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('resolves critical weapon damage before flat procs and healing', () => {
    const effects: AttackEffect[] = [
      { id: 'crit', name: 'Keen edge', trigger: 'onAttack', rateBps: 2000, kind: 'critical', multiplierBps: 20000 },
      { id: 'spark', name: 'Spark', trigger: 'onAttack', rateBps: 10000, kind: 'damage', amount: 7 },
      { id: 'mend', name: 'Mend', trigger: 'onAttack', rateBps: 2000, kind: 'heal', amount: 10 },
    ];
    let meters = emptyCombatMeters();
    for (let i = 1; i <= 10; i++) {
      const before = JSON.stringify(meters);
      const attack = resolveAttack(25, effects, meters);
      expect(JSON.stringify(meters)).toBe(before);
      expect(attack.damage).toBe(i % 5 === 0 ? 57 : 32);
      expect(attack.healing).toBe(i % 5 === 0 ? 10 : 0);
      expect(attack.events[0].critical).toBe(i % 5 === 0);
      meters = JSON.parse(JSON.stringify(attack.meters));
    }
  });

  it('applies only the strongest simultaneous critical multiplier', () => {
    const attack = resolveAttack(25, [
      { id: 'a', name: 'A', trigger: 'onAttack', rateBps: 10000, kind: 'critical', multiplierBps: 15000 },
      { id: 'b', name: 'B', trigger: 'onAttack', rateBps: 10000, kind: 'critical', multiplierBps: 20000 },
    ], emptyCombatMeters());
    expect(attack.damage).toBe(50);
  });

  it('resolves a killing blow with crit, damage, and healing procs without spending pushups', () => {
    const battle = beginBattle(0, '2026-09-06', { ...stats, attackEffects: [
      { id: 'crit', name: 'Keen edge', trigger: 'onAttack', rateBps: 10000, kind: 'critical', multiplierBps: 20000 },
      { id: 'spark', name: 'Spark', trigger: 'onAttack', rateBps: 10000, kind: 'damage', amount: 20 },
      { id: 'mend', name: 'Mend', trigger: 'onAttack', rateBps: 10000, kind: 'heal', amount: 30 },
    ] }, 95);
    const next = battleTurn({ ...battle, phase: 'fighting' });
    expect(next).toMatchObject({ heroHp: 100, defeated: 1, attacksMade: 1, lastAction: 'attack' });
    expect(next.meters.dodge).toBe(0);
    expect(next.stats.pushups).toBe(battle.stats.pushups);
  });

  it('dodges the fifth incoming hit even across an enemy change and JSON reload', () => {
    let battle = beginBattle(0, '2026-09-06', { ...stats, health: 1000, dodgeBps: 2000 }, 1000);
    let incoming = 0;
    const dodges: number[] = [];
    for (let i = 0; i < 100 && battle.status === 'active'; i++) {
      const before = battle;
      battle = JSON.parse(JSON.stringify(battleTurn(battle)));
      if (before.phase === 'fighting' && before.turn === 'enemy') {
        incoming++;
        if (battle.lastAction === 'dodge') {
          dodges.push(incoming);
          expect(battle.heroHp).toBe(before.heroHp);
          expect(battle.encounter).toBeGreaterThan(0);
        }
      }
    }
    expect(dodges).toEqual([5, 10, 15]);
  });

  it('attacks at base damage even with zero recorded pushups', () => {
    const battle = beginBattle(0, '2026-09-06', stats, 100);
    const next = battleTurn({ ...battle, phase: 'fighting', gold: 20, xp: 30 });
    expect(next).toMatchObject({ status: 'active', enemyHp: battle.enemyHp - 25, attacksMade: 1, gold: 20, xp: 30 });
  });
});
