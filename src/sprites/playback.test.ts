import { describe, expect, it } from 'vitest';
import catalog from '../../assets/sprites/catalog.json';
import { battleDungeon, battleTurn, beginBattle, DUNGEONS } from '../game/combat';
import { fitnessDay, heroStats } from '../game/rules';
import { battleSchedule, battleTickDuration, enemyAnimation, heroAnimation, journeyLeg, journeyTarget } from './battleAnimation';
import { clipFor, frameAt, sampleSprite, spriteGeometry } from './playback';
import { PLAYER_SPRITES } from './player';
import type { SpriteCatalog } from './types';

const entities = (catalog as unknown as SpriteCatalog).entities;
const player = entities.barbarian_player;
const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-10'));

describe('sprite playback', () => {
  it('loops on exact boundaries and holds a one-shot ending', () => {
    const idle = player.actions.idle, death = player.actions.death;
    expect(frameAt(idle, idle.frames[0].duration - 1).index).toBe(0);
    expect(frameAt(idle, idle.frames[0].duration).index).toBe(1);
    expect(frameAt(idle, idle.duration).index).toBe(0);
    expect(frameAt(death, death.duration + 10000)).toMatchObject({ index: 5, remaining: Infinity });
  });
  it('fits an attack to a combat beat then returns to idle', () => {
    expect(sampleSprite(player, 'attack', 360, 720).index).toBe(3);
    expect(sampleSprite(player, 'attack', 719, 720).index).toBe(5);
    expect(sampleSprite(player, 'attack', 720, 720).clip).toBe(player.actions.idle);
    expect(sampleSprite(player, 'attack', 720 + player.actions.idle.frames[0].duration, 720).index).toBe(1);
    expect(clipFor(player, 'unavailable')).toBe(player.actions.idle);
  });
  it.each(Object.values(PLAYER_SPRITES))('holds the windup, snaps to impact, and settles for %s', id => {
    const entity = entities[id];
    // At combat speed: 90ms peak windup, 27ms impact, 108ms follow-through.
    for (const [elapsed, index] of [[90, 2], [179, 2], [180, 3], [206, 3], [207, 4], [314, 4], [315, 5]]) {
      expect(sampleSprite(entity, 'attack', elapsed, 360).index).toBe(index);
    }
    expect(sampleSprite(entity, 'attack', 360, 360).clip).toBe(entity.actions.idle);
  });
  it('preserves feet and relative entity height when mirrored', () => {
    const toad = entities.bog_toad;
    const left = spriteGeometry(toad, 100, 'left'), right = spriteGeometry(toad, 100, 'right');
    expect(toad.idleHeight * left.scale).toBeCloseTo(55);
    expect(left.top).toBe(right.top);
    expect(left.left + right.left).toBeCloseTo(-left.width);
    expect(right.flipped).toBe(true);
  });
  it('ships every player and Wetlands state with valid timing and facing', () => {
    for (const id of ['barbarian_player', ...DUNGEONS[0].enemies.map(e => e.id!)]) {
      const entity = entities[id];
      expect(entity.facing).toBe(id === 'barbarian_player' ? 'right' : 'left');
      for (const action of ['idle', 'walk', 'attack', 'death']) {
        const clip = entity.actions[action];
        expect(clip.frames.length).toBeGreaterThan(1);
        expect(clip.frames.reduce((sum, f) => sum + f.duration, 0)).toBe(clip.duration);
        expect(clip.loop).toBe(action === 'idle' || action === 'walk');
      }
    }
  });
});

describe('battle animation and saved rosters', () => {
  it('keeps one walking leg across checkpoints, at the same speed before and after encounters', () => {
    let battle = beginBattle(0, '2026-09-10', stats);
    const leg = journeyLeg(battle);
    for (const position of [40, 120, 200]) {
      expect(journeyTarget(battle)).toBe(position);
      expect(journeyLeg(battle).key).toBe(leg.key);
      expect(journeyLeg(battle).walking).toBe(true);
      expect(battleTickDuration(battle)).toBe(500);
      battle = battleTurn(battle);
    }
    expect(journeyTarget(battle)).toBe(280);
    expect(journeyLeg(battle).walking).toBe(false);
    expect(battle).toMatchObject({ tick: 3, lastAction: 'attack', attacksMade: 1, enemyHp: 30 });
    expect(heroAnimation(battle)).toMatchObject({ action: 'attack', eventKey: 3 });
    const kill = battleTurn({ ...battle, turn: 'hero', enemyHp: 1 });
    expect(journeyTarget(kill)).toBe(280);
    expect(battleTickDuration(kill)).toBe(400);
    const walk = battleTurn(kill);
    expect(journeyLeg(walk).walking).toBe(true);
    expect(walk.travel).toBe(0);
    expect(journeyTarget(walk)).toBe(280);
    const nextLeg = journeyLeg(walk);
    expect(nextLeg.to).toBe(600);
    expect(nextLeg.duration).toBe(2000);
    expect((nextLeg.to - nextLeg.from) / nextLeg.duration).toBe((leg.to - leg.from) / leg.duration);
  });

  it('resumes a saved walking checkpoint with only the remaining time before arrival', () => {
    const battle = beginBattle(0, '2026-09-10', stats);
    const saved = battleTurn(battleTurn(battle));
    expect(battleSchedule(saved)).toEqual({ key: '0:walk', elapsed: 1000, deadline: 1500 });
    expect(heroAnimation(battleTurn(saved))).toMatchObject({ action: 'attack', durationMs: 360 });
  });

  it('records resolved damage, criticals and actual healing on the original target, then clears old impacts', () => {
    const battle = beginBattle(0, '2026-09-10', { ...stats, attackEffects: [
      { id: 'crit', name: 'Critical', trigger: 'onAttack', rateBps: 10000, kind: 'critical', multiplierBps: 20000 },
      { id: 'fire', name: 'Fire', trigger: 'onAttack', rateBps: 10000, kind: 'damage', amount: 7 },
      { id: 'heal', name: 'Heal', trigger: 'onAttack', rateBps: 10000, kind: 'heal', amount: 20 },
    ] });
    const hit = battleTurn({ ...battle, phase: 'fighting', travel: 3, heroHp: 95 });
    expect(hit.encounter).toBe(1);
    expect(hit.impacts).toEqual([
      { target: 'enemy', encounter: 0, kind: 'damage', amount: 57, critical: true },
      { target: 'hero', encounter: 0, kind: 'heal', amount: 5 },
    ]);
    expect(battleTurn(hit).impacts).toEqual([]);
    expect(JSON.parse(JSON.stringify(hit)).impacts).toEqual(hit.impacts);
  });

  it('distinguishes a dodged attack from a lethal hit without inferring damage from clamped HP', () => {
    const battle = { ...beginBattle(0, '2026-09-10', stats), phase: 'fighting' as const, turn: 'enemy' as const, heroHp: 1 };
    expect(battleTurn(battle)).toMatchObject({ status: 'defeat', impacts: [{ target: 'hero', encounter: 0, kind: 'damage', amount: 10 }] });
    expect(battleTurn({ ...battle, stats: { ...stats, dodgeBps: 1000 }, meters: { dodge: 9000, effects: {} } }))
      .toMatchObject({ status: 'active', heroHp: 1, impacts: [{ target: 'hero', encounter: 0, kind: 'miss', amount: 0 }] });
  });
  it('keeps the killing swing and the outgoing enemy death at the old location', () => {
    const battle = beginBattle(0, '2026-09-10', stats, 100);
    const kill = battleTurn({ ...battle, phase: 'fighting', travel: 3, enemyHp: 1 });
    expect(kill.encounter).toBe(1);
    expect(heroAnimation(kill)).toMatchObject({ action: 'attack', eventKey: kill.tick });
    expect(enemyAnimation(kill, 0).action).toBe('death');
    expect(enemyAnimation(kill, 1).action).toBe('idle');
    expect(journeyTarget(kill)).toBe(280);
    expect(heroAnimation(battleTurn(kill)).action).toBe('walk');
    expect(heroAnimation({ ...kill, heroHp: 0 }).action).toBe('death');
  });
  it('uses the saved roster after JSON reload and supports pre-snapshot saves', () => {
    const fresh = beginBattle(0, '2026-09-10', stats);
    const restored = JSON.parse(JSON.stringify(fresh));
    expect(battleDungeon(restored).enemies.map(e => e.id)).toContain('giant_water_strider');
    expect(fresh.dungeon).not.toBe(DUNGEONS[0]);
    expect(fresh.dungeon?.enemies[0]).not.toBe(DUNGEONS[0].enemies[0]);
    const legacy = { ...fresh, dungeon: undefined, phase: 'fighting' as const, enemyHp: 35, pushupUnits: 1000 };
    expect(battleDungeon(legacy).name).toBe('Mossfall Hollow');
    expect(battleDungeon(legacy).enemies).toHaveLength(4);
    expect(battleTurn(legacy).enemyHp).toBe(10);
  });
});
