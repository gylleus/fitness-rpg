import type { HeroStats } from './rules';
import { advanceMeter, emptyCombatMeters, resolveAttack, type CombatMeters } from './attacks';
import { attackCostUnits, pushupLabel } from './items';

export type Enemy = { name: string; health: number; attack: number; gold: number; xp: number; sprite: 'slime' | 'wolf' | 'knight' | 'boss' };
export type Dungeon = { id: number; name: string; subtitle: string; color: string; enemies: Enemy[] };
export const DUNGEONS: Dungeon[] = [
  { id: 0, name: 'Mossfall Hollow', subtitle: 'Something stirs beneath the roots.', color: '#8ae3b1', enemies: [
    { name: 'Moss Slime', health: 35, attack: 8, gold: 8, xp: 10, sprite: 'slime' },
    { name: 'Thornling', health: 55, attack: 10, gold: 10, xp: 15, sprite: 'slime' },
    { name: 'Hollow Wolf', health: 75, attack: 12, gold: 12, xp: 20, sprite: 'wolf' },
    { name: 'The Rootwarden', health: 140, attack: 18, gold: 40, xp: 40, sprite: 'boss' },
  ] },
  { id: 1, name: 'Embercrypt', subtitle: 'An old kingdom, still burning.', color: '#ffae80', enemies: [
    { name: 'Cinder Imp', health: 120, attack: 18, gold: 16, xp: 20, sprite: 'slime' },
    { name: 'Ash Knight', health: 160, attack: 22, gold: 20, xp: 25, sprite: 'knight' },
    { name: 'Fire Wisp', health: 190, attack: 25, gold: 24, xp: 30, sprite: 'slime' },
    { name: 'The Furnace King', health: 320, attack: 32, gold: 70, xp: 60, sprite: 'boss' },
  ] },
  { id: 2, name: 'Frostbound Keep', subtitle: 'The last light beyond the snow.', color: '#b6c3ff', enemies: [
    { name: 'Ice Crawler', health: 240, attack: 28, gold: 28, xp: 30, sprite: 'slime' },
    { name: 'Frost Guard', health: 300, attack: 34, gold: 32, xp: 35, sprite: 'knight' },
    { name: 'Snow Beast', health: 380, attack: 38, gold: 38, xp: 40, sprite: 'wolf' },
    { name: 'The Pale Regent', health: 580, attack: 46, gold: 110, xp: 90, sprite: 'boss' },
  ] },
];
export type BattleStatus = 'active' | 'victory' | 'defeat' | 'exhausted' | 'retreated' | 'expired';
export type BattleState = {
  dungeonId: number;
  day: string;
  stats: HeroStats;
  heroHp: number;
  enemyHp: number;
  encounter: number;
  defeated: number;
  turn: 'hero' | 'enemy';
  status: BattleStatus;
  gold: number;
  xp: number;
  log: string[];
  tick: number;
  phase: 'travelling' | 'fighting';
  travel: number;
  entryHp: number;
  pushupUnits: number;
  /** Actual cost paid in this attempt, including item discounts. */
  pushupUnitsSpent?: number;
  focusAttacks: number;
  meters: CombatMeters;
  attacksMade: number;
  lastAction: 'travel' | 'attack' | 'hit' | 'dodge' | 'exhausted';
};

export function beginBattle(dungeonId: number, day: string, stats: HeroStats, entryHp = stats.health,
  resources: { pushupUnits: number; focusAttacks?: number; meters?: CombatMeters } = { pushupUnits: 0 }): BattleState {
  const dungeon = DUNGEONS[dungeonId];
  if (!dungeon) throw new Error('Dungeon not found.');
  return { dungeonId, day, stats, heroHp: entryHp, entryHp, enemyHp: dungeon.enemies[0].health, encounter: 0, defeated: 0,
    turn: 'hero', status: 'active', phase: 'travelling', travel: 0, gold: 0, xp: 0, log: [`You enter ${dungeon.name}.`], tick: 0,
    pushupUnits: resources.pushupUnits, pushupUnitsSpent: 0, focusAttacks: resources.focusAttacks ?? 0, meters: resources.meters ?? emptyCombatMeters(), attacksMade: 0, lastAction: 'travel' };
}

/** A saved travel step or attack. Loot is carried until the boss is defeated. */
export function battleTurn(current: BattleState): BattleState {
  if (current.status !== 'active') return current;
  const next = { ...current, tick: current.tick + 1, log: [...current.log] };
  const enemies = DUNGEONS[current.dungeonId].enemies;
  const enemy = enemies[current.encounter];
  if (current.phase === 'travelling') {
    next.lastAction = 'travel';
    next.travel++;
    if (next.travel >= 3) {
      next.phase = 'fighting';
      next.log.push(`${enemy.name} blocks the path.`);
    }
    next.log = next.log.slice(-5);
    return next;
  }
  if (current.turn === 'hero') {
    const cost = attackCostUnits(current.stats.pushupCostUnits, current.focusAttacks);
    if (current.pushupUnits < cost) {
      return { ...next, status: 'exhausted', lastAction: 'exhausted', gold: 0, xp: 0,
        log: ['Your pushup stockpile cannot cover another attack. No loot earned. Entry health and spent pushups are restored.'] };
    }
    next.pushupUnits -= cost;
    next.pushupUnitsSpent = (current.pushupUnitsSpent ?? 0) + cost;
    next.focusAttacks = Math.max(0, current.focusAttacks - 1);
    next.attacksMade++;
    next.lastAction = 'attack';
    const attack = resolveAttack(current.stats.attack, current.stats.attackEffects, current.meters);
    next.meters = attack.meters;
    next.enemyHp = Math.max(0, current.enemyHp - attack.damage);
    next.heroHp = Math.min(current.stats.health, current.heroHp + attack.healing);
    next.log.push(`Attack uses ${pushupLabel(cost)} pushups.`);
    for (const event of attack.events) {
      next.log.push(event.kind === 'heal' ? `${event.source} restores up to ${event.amount} HP.`
        : `${event.critical ? 'Critical! ' : ''}${event.source} hits ${enemy.name} for ${event.amount}.`);
    }
    next.turn = 'enemy';
    if (next.enemyHp === 0) {
      next.defeated++;
      next.gold += enemy.gold;
      next.xp += enemy.xp;
      next.log.push(`${enemy.name} falls. ${enemy.gold} gold added to the pending bounty.`);
      if (current.encounter === enemies.length - 1) {
        next.status = 'victory';
        next.log.push('Boss defeated. The path is yours.');
      } else {
        next.encounter++;
        next.enemyHp = enemies[next.encounter].health;
        next.turn = 'hero';
        next.phase = 'travelling';
        next.travel = 0;
        next.log.push('You continue along the path.');
      }
    }
  } else {
    const dodge = advanceMeter(current.meters.dodge, current.stats.dodgeBps);
    next.meters = { ...current.meters, dodge: dodge.meter };
    next.lastAction = dodge.triggered ? 'dodge' : 'hit';
    next.heroHp = Math.max(0, current.heroHp - (dodge.triggered ? 0 : enemy.attack));
    next.log.push(dodge.triggered ? `Dodge! ${enemy.name} misses.` : `${enemy.name} hits you for ${enemy.attack}.`);
    next.turn = 'hero';
    if (next.heroHp === 0) {
      next.status = 'defeat';
      next.gold = 0;
      next.xp = 0;
      next.log.push('No loot earned. Entry health and spent pushups are restored.');
    }
  }
  next.log = next.log.slice(-5);
  return next;
}
