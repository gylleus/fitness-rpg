import { attackPower, damageAfterArmor, type HeroStats } from './rules';
import { advanceMeter, emptyCombatMeters, resolveAttack, type CombatMeters } from './attacks';
import wetlands from './rosters/wetlands.json';
import hollowDelve from './rosters/hollow_delve.json';
import { rollLoot, type LootDrop } from './equipment';
import { randomInt, seedFor } from './random';
import type { WeaponType } from './weapons';

export type Enemy = { id?: string; name: string; health: number; attack: number; gold: number; xp: number; sprite: 'slime' | 'wolf' | 'knight' | 'boss' };
export type DungeonDifficulty = 'normal' | 'heroic' | 'mythic';
export type Dungeon = {
  id: number; biomeId?: string; name: string; subtitle: string; color: string; enemies: Enemy[];
  /** Optional metadata keeps previously saved dungeon snapshots playable. */
  difficulty?: DungeonDifficulty; level?: number; stepCost?: number; offerId?: string; mapGeneration?: number; seed?: number;
  /** These nonboss roster positions contain a chest instead of their enemy. */
  chestEncounters?: number[];
};
export type DungeonOffer = Dungeon & {
  difficulty: DungeonDifficulty; level: number; stepCost: number; offerId: string; mapGeneration: number; seed: number;
};
export const DUNGEON_DIFFICULTIES: Record<DungeonDifficulty, { label: string; stepCost: number; encounters: number; bossMultiplier: number }> = {
  normal: { label: 'Normal', stepCost: 0, encounters: 5, bossMultiplier: 1 },
  heroic: { label: 'Heroic', stepCost: 1000, encounters: 8, bossMultiplier: 1.12 },
  mythic: { label: 'Mythic', stepCost: 5000, encounters: 12, bossMultiplier: 1.25 },
};
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
  { id: 3, biomeId: hollowDelve.biome_id, name: hollowDelve.name,
    subtitle: 'Blind hunters beneath the abandoned mines.', color: '#a4b8a0',
    enemies: (['troglodyte', 'giant_cave_spider', 'bone_slime', 'delve_dwarf', 'delve_gnoll'] as const)
      .map(id => hollowDelve.enemies[id] as Enemy) },
];

/** Stable offers for the current camp map. Only a victory advances generation. */
export function generateDungeonMap(playerLevel: number, generation: number): DungeonOffer[] {
  if (!Number.isSafeInteger(playerLevel) || playerLevel < 1 || !Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Dungeon maps require a positive hero level and a nonnegative generation.');
  }
  let state = seedFor(`camp-map-v1:${generation}:${playerLevel}`);
  const draw = (min: number, max: number) => { const roll = randomInt(state, min, max); state = roll.state; return roll.value; };
  const templates = [...DUNGEONS];
  // The first free expedition retains the familiar Wetlands introduction.
  if (generation > 0) {
    for (let i = templates.length - 1; i > 0; i--) {
      const j = draw(0, i);
      [templates[i], templates[j]] = [templates[j], templates[i]];
    }
  }
  return (['normal', 'normal', 'heroic', 'mythic'] as const).map((difficulty, slot) => {
    const template = templates[slot % templates.length];
    const settings = DUNGEON_DIFFICULTIES[difficulty];
    const level = difficulty === 'normal' ? draw(Math.max(1, playerLevel - 3), playerLevel) : playerLevel;
    const offerId = `camp-v1:${generation}:${slot}`;
    const seed = seedFor(`${offerId}:${level}:${template.id}`);
    const ordinary = template.enemies.slice(0, -1);
    const averageHealth = ordinary.reduce((sum, enemy) => sum + enemy.health, 0) / ordinary.length;
    const averageAttack = ordinary.reduce((sum, enemy) => sum + enemy.attack, 0) / ordinary.length;
    const enemyMultiplier = difficulty === 'mythic' ? 1.15 : difficulty === 'heroic' ? 1.08 : 1;
    const enemies = Array.from({ length: settings.encounters }, (_, encounter) => {
      const boss = encounter === settings.encounters - 1;
      const authored = boss ? template.enemies[template.enemies.length - 1] : ordinary[encounter % ordinary.length];
      // Retain authored enemy identities/art while removing the old chapter stat ladder.
      const healthRatio = Math.min(1.3, Math.max(0.75, authored.health / averageHealth));
      const attackRatio = Math.min(1.2, Math.max(0.8, authored.attack / averageAttack));
      return { ...authored,
        health: Math.round(boss ? (140 + (level - 1) * 25) * settings.bossMultiplier
          : (65 + (level - 1) * 10) * healthRatio * enemyMultiplier),
        attack: Math.round(boss ? (18 + (level - 1) * 2) * settings.bossMultiplier
          : (11 + (level - 1) * 1.5) * attackRatio * enemyMultiplier),
        gold: (boss ? 24 : 8) + level * (boss ? 4 : 2),
        xp: (boss ? 20 : 8) + level * (boss ? 4 : 2),
      };
    });
    // At most one replacement keeps each premium tier strictly longer in combat.
    const chestRoll = randomInt(seedFor(`chest-v1:${seed}`), 0, 99);
    const chestEncounters = chestRoll.value < 35
      ? [randomInt(chestRoll.state, 1, enemies.length - 2).value] : [];
    return { ...template, difficulty, level, stepCost: settings.stepCost, offerId, mapGeneration: generation, seed, enemies, chestEncounters };
  });
}
export type BattleStatus = 'active' | 'victory' | 'defeat' | 'exhausted' | 'retreated' | 'expired';
export type BattleImpact = {
  target: 'hero' | 'enemy';
  encounter: number;
  kind: 'damage' | 'heal' | 'miss';
  amount: number;
  critical?: boolean;
};
export type BattleState = {
  rulesVersion?: 2 | 3 | 4;
  rng?: { seed: number; state: number; generation: number };
  lootPlan?: LootDrop[];
  loot?: LootDrop[];
  dungeonId: number;
  /** Snapshot the roster so future content/art additions cannot change this run. */
  dungeon?: Dungeon;
  /** Visual loadout at entry; absent on old runs that used the mace knight. */
  weaponType?: WeaponType;
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
  phase: 'travelling' | 'fighting' | 'chest' | 'chest-reveal';
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
  resources: { focusAttacks?: number; meters?: CombatMeters; seed?: number; generation?: number; weaponType?: WeaponType; dungeon?: Dungeon } = {}): BattleState {
  const dungeon = resources.dungeon ?? DUNGEONS[dungeonId];
  if (!dungeon) throw new Error('Dungeon not found.');
  if (dungeon.id !== dungeonId || dungeon.enemies.length === 0) throw new Error('Invalid dungeon snapshot.');
  const seed = resources.seed ?? dungeon.seed;
  const seeded = seed !== undefined;
  const chestEncounters = [...new Set(dungeon.chestEncounters ?? [])]
    .filter(encounter => Number.isInteger(encounter) && encounter >= 0 && encounter < dungeon.enemies.length - 1);
  return { rulesVersion: dungeon.difficulty ? 4 : seeded ? 3 : 2,
    weaponType: resources.weaponType ?? 'mace',
    ...(seeded ? { rng: { seed, state: seedFor(`combat-v1:${seed}`), generation: resources.generation ?? dungeon.mapGeneration ?? 0 },
      loot: [], lootPlan: dungeon.enemies.flatMap((_, i) => rollLoot(seed, i, i === dungeon.enemies.length - 1, dungeonId,
        { difficulty: dungeon.difficulty, level: dungeon.level, chest: chestEncounters.includes(i) })) } : {}),
    dungeonId, dungeon: { ...dungeon, ...(dungeon.chestEncounters ? { chestEncounters } : {}), enemies: dungeon.enemies.map(enemy => ({ ...enemy })) }, day, stats, heroHp: entryHp, entryHp, enemyHp: dungeon.enemies[0].health, encounter: 0, defeated: 0,
    turn: 'hero', status: 'active', phase: 'travelling', travel: 0, gold: 0, xp: 0, log: [`You enter ${dungeon.name}.`], tick: 0,
    focusAttacks: resources.focusAttacks ?? 0, meters: seeded ? emptyCombatMeters() : resources.meters ?? emptyCombatMeters(), attacksMade: 0, lastAction: 'travel' };
}

/** A saved travel step or attack. Pushup power is fixed at entry and never spent. */
export function battleTurn(current: BattleState): BattleState {
  if (current.status !== 'active' || current.phase === 'chest' || current.phase === 'chest-reveal') return current;
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
    if (battleDungeon(current).chestEncounters?.includes(current.encounter)) {
      next.phase = 'chest';
      next.enemyHp = 0;
      next.log.push('A closed chest waits beside the path. Open it or continue?');
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

/** Opening and leaving are separate saved actions; the travel timer cannot loot a chest. */
export function resolveChest(current: BattleState, action: 'open' | 'skip' | 'continue'): BattleState {
  if (current.status !== 'active') return current;
  const opening = current.phase === 'chest' && action === 'open';
  const leaving = (current.phase === 'chest' && action === 'skip') || (current.phase === 'chest-reveal' && action === 'continue');
  if (!opening && !leaving) return current;
  const next = { ...current, tick: current.tick + 1, log: [...current.log], impacts: [] as BattleImpact[] };
  if (opening) {
    const contents = (current.lootPlan ?? []).filter(drop => drop.encounter === current.encounter);
    next.loot = [...(current.loot ?? []), ...contents];
    next.phase = 'chest-reveal';
    next.log.push(contents.length ? `The chest contains ${contents.map(drop => drop.item.name).join(', ')}.` : 'The chest is empty.');
  } else {
    const enemies = battleDungeon(current).enemies;
    if (current.encounter >= enemies.length - 1) return current;
    next.encounter++;
    next.enemyHp = enemies[next.encounter].health;
    next.turn = 'hero';
    next.phase = 'travelling';
    next.travel = 0;
    next.lastAction = 'travel';
    next.log.push(action === 'skip' ? 'You leave the chest closed and continue.' : 'You close the chest and continue.');
  }
  next.log = next.log.slice(-5);
  return next;
}
