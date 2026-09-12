import { attackPower, damageAfterArmor, type HeroStats } from './rules';
import { advanceMeter, emptyCombatMeters, resolveAttack, type CombatMeters } from './attacks';
import wetlands from './rosters/wetlands.json';
import { rollLoot, type LootDrop } from './equipment';
import { randomInt, seedFor } from './random';

export type Enemy = { id?: string; name: string; health: number; attack: number; gold: number; xp: number; sprite: 'slime' | 'wolf' | 'knight' | 'boss' };
export type Dungeon = { id: number; biomeId?: string; name: string; subtitle: string; color: string; enemies: Enemy[] };
// Pre-snapshot saves retain their original enemies and balances.
const LEGACY_DUNGEONS: Dungeon[] = [
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
// Expedition order is a game rule, independent of the biome's random spawn pool.
export const DUNGEONS: Dungeon[] = [
  { id: 0, biomeId: wetlands.biome_id, name: wetlands.name, subtitle: 'A path through reeds, dark pools and tangled roots.', color: '#8ae3b1',
    enemies: (['bog_toad', 'drowned_corpse', 'giant_water_strider', 'bog_hag', 'root_hulk'] as const)
      .map(id => wetlands.enemies[id] as Enemy) },
  ...LEGACY_DUNGEONS.slice(1),
];
export type BattleStatus = 'active' | 'victory' | 'defeat' | 'exhausted' | 'retreated' | 'expired';
export type BattleImpact = {
  target: 'hero' | 'enemy';
  encounter: number;
  kind: 'damage' | 'heal' | 'miss';
  amount: number;
  critical?: boolean;
};
export type BattleState = {
  rulesVersion?: 2 | 3;
  rng?: { seed: number; state: number; generation: number };
  lootPlan?: LootDrop[];
  loot?: LootDrop[];
  dungeonId: number;
  /** Snapshot the roster so future content/art additions cannot change this run. */
  dungeon?: Dungeon;
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
  focusAttacks: number;
  meters: CombatMeters;
  attacksMade: number;
  lastAction: 'travel' | 'attack' | 'hit' | 'dodge' | 'exhausted';
  /** Outcomes of this tick, including the original target of a finishing blow. */
  impacts?: BattleImpact[];
};

export function battleDungeon(battle: BattleState): Dungeon {
  return battle.dungeon ?? LEGACY_DUNGEONS[battle.dungeonId];
}

export function beginBattle(dungeonId: number, day: string, stats: HeroStats, entryHp = stats.health,
  resources: { focusAttacks?: number; meters?: CombatMeters; seed?: number; generation?: number } = {}): BattleState {
  const dungeon = DUNGEONS[dungeonId];
  if (!dungeon) throw new Error('Dungeon not found.');
  const seeded = resources.seed !== undefined;
  return { rulesVersion: seeded ? 3 : 2,
    ...(seeded ? { rng: { seed: resources.seed!, state: seedFor(`combat-v1:${resources.seed}`), generation: resources.generation ?? 0 },
      loot: [], lootPlan: dungeon.enemies.flatMap((_, i) => rollLoot(resources.seed!, i, i === dungeon.enemies.length - 1, dungeonId)) } : {}),
    dungeonId, dungeon: { ...dungeon, enemies: dungeon.enemies.map(enemy => ({ ...enemy })) }, day, stats, heroHp: entryHp, entryHp, enemyHp: dungeon.enemies[0].health, encounter: 0, defeated: 0,
    turn: 'hero', status: 'active', phase: 'travelling', travel: 0, gold: 0, xp: 0, log: [`You enter ${dungeon.name}.`], tick: 0,
    focusAttacks: resources.focusAttacks ?? 0, meters: seeded ? emptyCombatMeters() : resources.meters ?? emptyCombatMeters(), attacksMade: 0, lastAction: 'travel' };
}

/** A saved travel step or attack. Pushup power is fixed at entry and never spent. */
export function battleTurn(current: BattleState): BattleState {
  if (current.status !== 'active') return current;
  const next = { ...current, tick: current.tick + 1, log: [...current.log], impacts: [] as BattleImpact[] };
  const enemies = battleDungeon(current).enemies;
  const enemy = enemies[current.encounter];
  const draw = (min: number, max: number) => {
    const rolled = randomInt(next.rng!.state, min, max);
    next.rng = { ...next.rng!, state: rolled.state };
    return rolled.value;
  };
  if (current.phase === 'travelling') {
    next.lastAction = 'travel';
    // A killing swing owns its recovery tick. Walking starts at the beginning
    // of the next leg instead of skipping its first travel segment.
    next.travel = current.lastAction === 'attack' ? 0 : current.travel + 1;
    if (next.travel < 3) {
      next.log = next.log.slice(-5);
      return next;
    }
    next.phase = 'fighting';
    next.log.push(`${enemy.name} blocks the path.`);
    // Arrival is also the first attack: switch straight from walking to the
    // windup, rather than waiting through an extra idle combat beat.
  }
  if (current.phase === 'travelling' || current.turn === 'hero') {
    next.focusAttacks = Math.max(0, current.focusAttacks - 1);
    next.attacksMade++;
    next.lastAction = 'attack';
    const baseDamage = current.rng ? draw(current.stats.baseDamageMin ?? current.stats.baseAttack, current.stats.baseDamageMax ?? current.stats.baseAttack) : current.stats.baseAttack;
    const attack = resolveAttack(attackPower(current.stats, current.focusAttacks, baseDamage).damage, current.stats.attackEffects, current.meters,
      current.rng ? rate => draw(0, 9999) < rate : undefined);
    next.meters = attack.meters;
    next.enemyHp = Math.max(0, current.enemyHp - attack.damage);
    next.heroHp = Math.min(current.stats.health, current.heroHp + attack.healing);
    next.impacts.push({ target: 'enemy', encounter: current.encounter, kind: 'damage', amount: attack.damage,
      critical: attack.events.some(event => event.critical) });
    if (next.heroHp > current.heroHp) next.impacts.push({ target: 'hero', encounter: current.encounter, kind: 'heal', amount: next.heroHp - current.heroHp });
    for (const event of attack.events) {
      next.log.push(event.kind === 'heal' ? `${event.source} restores up to ${event.amount} HP.`
        : `${event.critical ? 'Critical! ' : ''}${event.source} hits ${enemy.name} for ${event.amount}.`);
    }
    next.turn = 'enemy';
    if (next.enemyHp === 0) {
      if (current.lootPlan) next.loot = [...(current.loot ?? []), ...current.lootPlan.filter(drop => drop.encounter === current.encounter)];
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
    const dodge = current.rng ? { triggered: draw(0, 9999) < current.stats.dodgeBps, meter: current.meters.dodge }
      : advanceMeter(current.meters.dodge, current.stats.dodgeBps);
    next.meters = { ...current.meters, dodge: dodge.meter };
    next.lastAction = dodge.triggered ? 'dodge' : 'hit';
    const damage = dodge.triggered ? 0 : damageAfterArmor(enemy.attack, current.stats.armor);
    next.heroHp = Math.max(0, current.heroHp - damage);
    next.impacts.push({ target: 'hero', encounter: current.encounter, kind: dodge.triggered ? 'miss' : 'damage', amount: damage });
    next.log.push(dodge.triggered ? `Dodge! ${enemy.name} misses.` : `${enemy.name} hits you for ${damage}.`);
    next.turn = 'hero';
    if (next.heroHp === 0) {
      next.status = 'defeat';
      next.gold = 0;
      next.xp = 0;
      if (next.loot) next.loot = [];
      next.log.push('No loot earned. Your entry health is restored.');
    }
  }
  next.log = next.log.slice(-5);
  return next;
}
