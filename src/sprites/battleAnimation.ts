import type { BattleState } from '../game/combat';

export function heroAnimation(battle: BattleState) {
  if (battle.heroHp === 0) return { action: 'death', durationMs: 800 };
  if (battle.lastAction === 'attack') return { action: 'attack', eventKey: battle.tick, durationMs: HERO_ATTACK_DURATION_MS };
  return { action: battle.status === 'active' && battle.phase === 'travelling' ? 'walk' : 'idle' };
}

export function enemyAnimation(battle: BattleState, index: number) {
  if (index < battle.defeated) return { action: 'death', durationMs: 720 };
  if (index === battle.encounter && (battle.lastAction === 'hit' || battle.lastAction === 'dodge')) {
    return { action: 'attack', eventKey: battle.tick, durationMs: 720 };
  }
  return { action: 'idle' };
}

export const WALK_PIXELS_PER_SECOND = 160;
export const HERO_ATTACK_DURATION_MS = 360;
export const HERO_ATTACK_IMPACT_MS = 180;
export const ENEMY_ATTACK_IMPACT_MS = 420;

/** One uninterrupted leg, shared by movement and the saved combat checkpoints. */
export function journeyLeg(battle: BattleState) {
  const from = battle.encounter === 0 ? 40 : 40 + (battle.encounter - 1) * 320 + 240;
  const to = 40 + battle.encounter * 320 + 240;
  const duration = (to - from) / WALK_PIXELS_PER_SECOND * 1000;
  const walking = battle.status === 'active' && battle.phase === 'travelling' && battle.lastAction !== 'attack';
  const fraction = battle.phase === 'fighting' ? 1 : Math.max(0, Math.min(3, battle.travel ?? 3)) / 3;
  return { from, to, duration, walking, fraction, key: `${battle.encounter}:${walking ? 'walk' : 'hold'}` };
}

export function journeyTarget(battle: BattleState) {
  const leg = journeyLeg(battle);
  return leg.from + (leg.to - leg.from) * leg.fraction;
}

export function battleTickDuration(battle: BattleState) {
  return journeyLeg(battle).walking ? journeyLeg(battle).duration / 3
    : battle.lastAction === 'attack' ? HERO_ATTACK_DURATION_MS + 40 : 800;
}

/** Travel checkpoints share a deadline clock with the uninterrupted walk. */
export function battleSchedule(battle: BattleState) {
  const leg = journeyLeg(battle);
  return leg.walking
    ? { key: leg.key, elapsed: leg.duration * leg.fraction,
      deadline: Math.min(leg.duration, leg.duration * (leg.fraction + 1 / 3)) }
    : { key: `tick:${battle.tick}`, elapsed: 0, deadline: battleTickDuration(battle) };
}
