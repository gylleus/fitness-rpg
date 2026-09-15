import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { activityDays, campMaps, challengeClaims, dungeonRuns, dungeonSeeds, heroes, inventoryItems, runs, sessions, sets, travelDays } from './schema';
import { beginBattle, battleTurn, generateDungeonMap, resolveChest, type BattleState } from '../game/combat';
import { attackPower, CHALLENGES, DAILY_RESET_HOUR, dayStart, fitnessDay, heroStats, localDay, nextDailyReset, recentDays, validateRun, validateSteps,
  type ChallengeId, type RunActivity } from '../game/rules';
import { FOCUS_ATTACKS, HEALING_HP, POTIONS, type Potion } from '../game/items';
import { getEquipped, getInventory, initializeInventory } from './inventory';
import { equippedWeaponType, upgradeGear } from '../game/equipment';

// Both production Expo SQLite and the test SQLite driver execute synchronously.
// Never put an async callback inside these transactions.
export type GameDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export function getHero(db: GameDb) {
  db.insert(heroes).values({ id: 1 }).onConflictDoNothing().run();
  const hero = db.select().from(heroes).where(eq(heroes.id, 1)).get()!;
  if (hero.inventoryVersion < 3) { initializeInventory(db); return { ...hero, inventoryVersion: 3 }; }
  return hero;
}

/** Lifetime full reps for workout receipts and history, independent of daily power. */
export function getSavedPushups(db: GameDb) {
  const reps = db.select({ total: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number) })
    .from(sets).innerJoin(sessions, eq(sets.sessionId, sessions.id)).where(eq(sessions.exercise, 'pushup')).get()!;
  return Math.max(0, reps.total);
}

export function getFitnessDay(db: GameDb, day = localDay()) {
  const start = dayStart(day);
  const end = nextDailyReset(start);
  const reps = db.select({
    full: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number),
    partial: sql<number>`coalesce(sum(${sets.partialReps}), 0)`.mapWith(Number),
  }).from(sets).innerJoin(sessions, eq(sets.sessionId, sessions.id))
    .where(and(eq(sessions.exercise, 'pushup'), gte(sets.endedAt, start), lt(sets.endedAt, end))).get()!;
  const entered = db.select().from(activityDays).where(eq(activityDays.day, day)).get();
  const dayRuns = db.select().from(runs).where(eq(runs.day, day)).all();
  return { ...fitnessDay(day, reps.full, reps.partial, entered?.nativeSteps ?? entered?.enteredSteps ?? 0, dayRuns), stepSource: entered?.stepSource ?? 'legacy', syncedAt: entered?.syncedAt ?? null };
}

function assertDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayStart(day)) || localDay(dayStart(day)) !== day) throw new Error('Invalid activity date.');
}

export function saveStepTotal(db: GameDb, day: string, total: number) {
  assertDay(day);
  validateSteps(total);
  db.insert(activityDays).values({ day, enteredSteps: total })
    .onConflictDoUpdate({ target: activityDays.day, set: { enteredSteps: total } }).run();
}

export function saveRun(db: GameDb, day: string, run: RunActivity, sourceKey: string, now = Date.now()) {
  assertDay(day);
  validateRun(run);
  if (!sourceKey) throw new Error('Missing run identifier.');
  db.insert(runs).values({ ...run, day, sourceKey, createdAt: now }).onConflictDoNothing({ target: runs.sourceKey }).run();
}

export function deleteRun(db: GameDb, id: number) {
  db.transaction((tx) => {
    const run = tx.select().from(runs).where(eq(runs.id, id)).get();
    if (run?.recordingId) tx.delete(schema.runRecordings).where(eq(schema.runRecordings.id, run.recordingId)).run();
    tx.delete(runs).where(eq(runs.id, id)).run();
  });
}

export function savePushupWorkout(db: GameDb, input: {
  sourceKey: string; startedAt: number; endedAt: number; validReps: number; partialReps: number;
}) {
  if (!input.sourceKey || !Number.isFinite(input.startedAt) || !Number.isFinite(input.endedAt) || input.endedAt < input.startedAt) throw new Error('Invalid workout times.');
  for (const count of [input.validReps, input.partialReps]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new Error('Invalid rep count.');
  }
  return db.transaction((tx) => {
    const previous = tx.select().from(sessions).where(eq(sessions.sourceKey, input.sourceKey)).get();
    if (previous) return previous.id;
    const session = tx.insert(sessions).values({ exercise: 'pushup', sourceKey: input.sourceKey, startedAt: input.startedAt, endedAt: input.endedAt }).returning().get();
    tx.insert(sets).values({ sessionId: session.id, validReps: input.validReps, partialReps: input.partialReps, startedAt: input.startedAt, endedAt: input.endedAt }).run();
    return session.id;
  });
}

export function claimChallenge(db: GameDb, id: ChallengeId, now = Date.now()) {
  return db.transaction((tx) => {
    const day = localDay(now);
    const challenge = CHALLENGES.find((c) => c.id === id);
    if (!challenge) throw new Error('Challenge not found.');
    const today = getFitnessDay(tx, day);
    if (today[challenge.metric] < challenge.target) throw new Error('Keep going! This challenge is not complete yet.');
    getHero(tx);
    const claim = tx.insert(challengeClaims).values({ day, challengeId: id }).onConflictDoNothing().returning().get();
    if (!claim) return false;
    tx.update(heroes).set({ gold: sql`${heroes.gold} + ${challenge.reward}` }).where(eq(heroes.id, 1)).run();
    return true;
  });
}

export function purchasePotion(db: GameDb, kind: Potion) {
  return db.transaction(tx => {
    const potion = POTIONS[kind];
    if (!potion) throw new Error('Potion not found.');
    const hero = getHero(tx);
    if (hero.gold < potion.cost) throw new Error(`You need ${potion.cost} gold for this potion.`);
    tx.update(heroes).set({ gold: hero.gold - potion.cost, [potion.field]: hero[potion.field] + 1 }).where(eq(heroes.id, 1)).run();
  });
}

export function drinkPotion(db: GameDb, kind: Potion, now = Date.now()) {
  return db.transaction(tx => {
    expireBattles(tx, now);
    if (tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).get()) throw new Error('Return to camp before drinking a potion.');
    const potion = POTIONS[kind];
    if (!potion) throw new Error('Potion not found.');
    const hero = getHero(tx);
    if (hero[potion.field] <= 0) throw new Error('Buy this potion from Supplies first.');
    if (kind === 'health') {
      const day = localDay(now);
      const maximum = heroStats(hero, getFitnessDay(tx, day), undefined, getEquipped(tx)).health;
      const health = availableHealth(hero, maximum, day);
      if (health === maximum) throw new Error('Your health is already full.');
      tx.update(heroes).set({ healthPotions: hero.healthPotions - 1, damageDay: day,
        damageTaken: Math.max(0, maximum - health - HEALING_HP) }).where(eq(heroes.id, 1)).run();
    } else {
      if (hero.focusAttacks > 0) throw new Error('Your focus potion is still active.');
      tx.update(heroes).set({ focusPotions: hero.focusPotions - 1, focusAttacks: FOCUS_ATTACKS }).where(eq(heroes.id, 1)).run();
    }
  });
}

/** Called only for an active run, inside its transaction. */
function saveBattleCheckpoint(db: GameDb, id: number, state: BattleState) {
  return db.update(dungeonRuns).set({ status: state.status, state }).where(eq(dungeonRuns.id, id)).returning().get();
}

export function expireBattles(db: GameDb, now = Date.now()) {
  db.transaction(tx => {
    const active = tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).all();
    for (const run of active) {
      if (run.state.day === localDay(now)) continue;
      saveBattleCheckpoint(tx, run.id, { ...run.state, status: 'expired', gold: 0, xp: 0, loot: [],
        log: ['It is a new fitness day. Travel steps, pushup damage, and running dodge reset at 5 AM device time. Start a fresh expedition.'] });
    }
  });
}

export function getDungeonMap(db: GameDb) {
  const saved = db.select().from(campMaps).where(eq(campMaps.id, 1)).get();
  if (saved) return saved;
  const hero = getHero(db);
  db.insert(campMaps).values({ id: 1, generation: 0,
    offers: generateDungeonMap(1 + Math.floor(hero.xp / 100), 0) }).onConflictDoNothing().run();
  return db.select().from(campMaps).where(eq(campMaps.id, 1)).get()!;
}

export function getTravelSteps(db: GameDb, day = localDay()) {
  const earned = getFitnessDay(db, day).steps;
  const travel = db.select().from(travelDays).where(eq(travelDays.day, day)).get();
  const spent = travel?.spent ?? 0, bonus = travel?.bonusSteps ?? 0;
  return { earned, spent, bonus, available: Math.max(0, earned + bonus - spent) };
}

/** String offer IDs reject stale map selections. Numeric IDs select a current map slot. */
export function startDungeon(db: GameDb, offerId: string | number, now = Date.now()) {
  return db.transaction((tx) => {
    expireBattles(tx, now);
    const active = tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).get();
    if (active) return active;
    const hero = getHero(tx);
    const map = getDungeonMap(tx);
    const dungeon = typeof offerId === 'string' ? map.offers.find(offer => offer.offerId === offerId)
      : Number.isInteger(offerId) ? map.offers[offerId] : undefined;
    if (!dungeon) throw new Error('This path is no longer available. Choose a dungeon from the refreshed camp map.');
    const day = localDay(now);
    const equipped = getEquipped(tx);
    const stats = heroStats(hero, getFitnessDay(tx, day), undefined, equipped);
    const health = availableHealth(hero, stats.health, day);
    if (health <= 0) throw new Error('Your hero needs more health. Drink a healing potion, equip health bonuses, or return tomorrow.');
    const travel = getTravelSteps(tx, day);
    if (travel.available < dungeon.stepCost) throw new Error(`You need ${dungeon.stepCost.toLocaleString()} travel steps for this dungeon; ${travel.available.toLocaleString()} available today.`);
    if (dungeon.stepCost > 0) tx.insert(travelDays).values({ day, spent: dungeon.stepCost })
      .onConflictDoUpdate({ target: travelDays.day, set: { spent: sql`${travelDays.spent} + ${dungeon.stepCost}` } }).run();
    const state = beginBattle(dungeon.id, day, stats, health, { focusAttacks: hero.focusAttacks, dungeon,
      seed: dungeon.seed, generation: map.generation, weaponType: equippedWeaponType(equipped) });
    return tx.insert(dungeonRuns).values({ startedAt: now, state, status: 'active' }).returning().get();
  });
}

/** Tick guard handles stale callbacks. Focus, meters, bounty, and checkpoint
 * share one transaction, including failures and the boss's final attack.
 */
export function advanceDungeon(db: GameDb, id: number, expectedTick: number, now = Date.now()) {
  return db.transaction((tx) => {
    expireBattles(tx, now);
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.status !== 'active' || run.state.tick !== expectedTick) return run;
    const hero = getHero(tx);
    // All damage inputs are snapshotted at entry. New training powers the next run.
    const next = battleTurn(run.state);
    if (next === run.state) return run;
    tx.update(heroes).set({ focusAttacks: next.focusAttacks, ...(next.rng ? {} : { combatMeters: next.meters }) }).where(eq(heroes.id, 1)).run();
    if (next.status === 'victory') {
      // Award once in the same transaction as the final checkpoint. Level-up
      // health does not refill the hero on victory; the exact remaining HP stays.
      const maxHealth = heroStats({ ...hero, xp: hero.xp + next.xp }, getFitnessDay(tx, next.day), undefined, getEquipped(tx)).health;
      if (next.rng) {
        // A pre-catalog run can finish after the bag migration. The awarded
        // snapshot and result preview must show the same upgraded item.
        if (next.loot) next.loot = next.loot.map(drop => ({ ...drop, item: upgradeGear(drop.item) }));
        for (const [i, drop] of (next.loot ?? []).entries()) {
          tx.insert(inventoryItems).values({ item: drop.item, slot: null, acquiredAt: now, sourceKey: `run:${id}:loot:${i}` }).run();
        }
        // Pre-map expeditions keep their historical reward guard and saved rolls.
        if (next.dungeon?.mapGeneration === undefined) {
          const advanced = tx.update(dungeonSeeds).set({ victories: next.rng.generation + 1 })
            .where(and(eq(dungeonSeeds.dungeonId, next.dungeonId), eq(dungeonSeeds.victories, next.rng.generation))).returning().get();
          if (!advanced) throw new Error('This dungeon reward has already been completed.');
        }
      }
      const map = getDungeonMap(tx);
      const generation = next.dungeon?.mapGeneration ?? map.generation;
      const refreshed = tx.update(campMaps).set({ generation: generation + 1,
        offers: generateDungeonMap(1 + Math.floor((hero.xp + next.xp) / 100), generation + 1) })
        .where(and(eq(campMaps.id, 1), eq(campMaps.generation, generation))).returning().get();
      if (!refreshed) throw new Error('This dungeon reward has already been completed.');
      tx.update(heroes).set({ gold: hero.gold + next.gold, xp: hero.xp + next.xp,
        damageDay: next.day, damageTaken: Math.max(0, maxHealth - next.heroHp),
      }).where(eq(heroes.id, 1)).run();
    }
    return saveBattleCheckpoint(tx, id, next);
  });
}

/** Chest decisions use the same tick guard as combat; contents are awarded on victory. */
export function resolveDungeonChest(db: GameDb, id: number, expectedTick: number,
  action: 'open' | 'skip' | 'continue', now = Date.now()) {
  return db.transaction(tx => {
    expireBattles(tx, now);
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.status !== 'active' || run.state.tick !== expectedTick) return run;
    const next = resolveChest(run.state, action);
    return next === run.state ? run : saveBattleCheckpoint(tx, id, next);
  });
}

export function retreatDungeon(db: GameDb, id: number) {
  db.transaction(tx => {
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.status !== 'active') return;
    saveBattleCheckpoint(tx, id, { ...run.state, status: 'retreated', gold: 0, xp: 0, loot: [],
      log: ['You return without loot. Entry health is restored. Used potion charges stay spent.'] });
  });
}

/** Keep the result in history while clearing it from the expedition screen. */
export function dismissDungeonResult(db: GameDb, id: number, now = Date.now()) {
  db.transaction(tx => {
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.dismissedAt !== null) return;
    if (run.status === 'active') throw new Error('Finish or retreat from this expedition first.');
    tx.update(dungeonRuns).set({ dismissedAt: now }).where(eq(dungeonRuns.id, id)).run();
  });
}

export function availableHealth(hero: { damageDay: string | null; damageTaken: number }, maxHealth: number, day: string) {
  return Math.max(0, maxHealth - (hero.damageDay === day ? hero.damageTaken : 0));
}

export function getGameSnapshot(db: GameDb, now = Date.now()) {
  expireBattles(db, now);
  const hero = getHero(db);
  const history = recentDays(now).map((day) => getFitnessDay(db, day));
  const today = history[history.length - 1];
  const dailyReps = db.select({ total: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number) })
    .from(sets).innerJoin(sessions, eq(sessions.id, sets.sessionId)).where(eq(sessions.exercise, 'pushup'))
    .groupBy(sql`date(${sets.endedAt} / 1000, 'unixepoch', 'localtime', ${`-${DAILY_RESET_HOUR} hours`})`).all();
  const runTotals = db.select({ distance: sql<number>`coalesce(sum(${runs.distanceMeters}), 0)`.mapWith(Number),
    count: sql<number>`count(*)`.mapWith(Number) }).from(runs).get()!;
  const savedPushups = getSavedPushups(db);
  const inventory = getInventory(db);
  const stats = heroStats(hero, today, undefined, inventory);
  const latestRun = db.select().from(dungeonRuns).orderBy(desc(dungeonRuns.id)).limit(1).get();
  // Select the latest first: filtering dismissed rows in SQL would resurrect
  // an even older result when the player clears the current one.
  const latestBattle = latestRun && latestRun.dismissedAt === null ? latestRun : null;
  const power = attackPower(stats, hero.focusAttacks);
  return {
    hero, today, history, stats, inventory, savedPushups, dungeonMap: getDungeonMap(db).offers, travelSteps: getTravelSteps(db, today.day),
    damage: power.damage, damageMin: power.minDamage, damageMax: power.maxDamage, damageMultiplier: power.multiplier,
    currentHealth: availableHealth(hero, stats.health, today.day),
    claimed: db.select().from(challengeClaims).where(eq(challengeClaims.day, today.day)).all().map((c) => c.challengeId),
    latestBattle,
    recentRuns: db.select().from(runs).where(gte(runs.day, history[0].day)).orderBy(desc(runs.createdAt)).all(),
    totals: { pushups: dailyReps.reduce((sum, r) => sum + r.total, 0), bestPushupDay: Math.max(0, ...dailyReps.map((r) => r.total)),
      distanceMeters: runTotals.distance, runs: runTotals.count },
  };
}
export type GameSnapshot = ReturnType<typeof getGameSnapshot>;
