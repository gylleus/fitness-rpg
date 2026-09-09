import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { activityDays, challengeClaims, dungeonRuns, heroes, runs, sessions, sets } from './schema';
import { beginBattle, battleTurn, DUNGEONS, type BattleState } from '../game/combat';
import { CHALLENGES, dayStart, fitnessDay, heroStats, localDay, nextMidnight, recentDays, upgradeCost, validateRun, validateSteps,
  type ChallengeId, type Equipment, type RunActivity } from '../game/rules';
import { AMULET, attackCostUnits, attacksAvailable, FOCUS_ATTACKS, HEALING_HP, POTIONS, PUSHUP_UNITS, type Potion } from '../game/items';

// Both production Expo SQLite and the test SQLite driver execute synchronously.
// Never put an async callback inside these transactions.
export type GameDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export function getHero(db: GameDb) {
  db.insert(heroes).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(heroes).where(eq(heroes.id, 1)).get()!;
}

/** Earned reps stay in fitness history; only spending belongs to the game save.
 * This includes legacy workouts without a one-time credit that could duplicate.
 */
export function getPushupUnits(db: GameDb, spent = getHero(db).pushupUnitsSpent) {
  const reps = db.select({ total: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number) })
    .from(sets).innerJoin(sessions, eq(sets.sessionId, sessions.id)).where(eq(sessions.exercise, 'pushup')).get()!;
  return Math.max(0, reps.total * PUSHUP_UNITS - spent);
}

export function getFitnessDay(db: GameDb, day = localDay()) {
  const start = dayStart(day);
  const end = nextMidnight(start);
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

export function purchaseUpgrade(db: GameDb, equipment: Equipment) {
  return db.transaction((tx) => {
    const hero = getHero(tx);
    const key = equipment === 'sword' ? 'swordLevel' : 'armorLevel';
    const cost = upgradeCost(hero[key]);
    if (hero.gold < cost) throw new Error(`You need ${cost - hero.gold} more gold for this upgrade.`);
    tx.update(heroes).set({ gold: hero.gold - cost, [key]: hero[key] + 1 }).where(eq(heroes.id, 1)).run();
  });
}

export function purchaseAmulet(db: GameDb) {
  return db.transaction(tx => {
    const hero = getHero(tx);
    if (hero.amuletOwned) throw new Error('This amulet is already equipped.');
    if (hero.unlockedDungeon < AMULET.unlockDungeon) throw new Error('Defeat the Rootwarden to unlock this rare amulet.');
    if (hero.gold < AMULET.cost) throw new Error('You need 150 gold for this amulet.');
    tx.update(heroes).set({ gold: hero.gold - AMULET.cost, amuletOwned: true }).where(eq(heroes.id, 1)).run();
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
    if (hero[potion.field] <= 0) throw new Error('Buy this potion at the forge first.');
    if (kind === 'health') {
      const day = localDay(now);
      const maximum = heroStats(hero, getFitnessDay(tx, day)).health;
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

/** Called only for an active run, inside its transaction. The terminal status
 * and refund commit together, so repeated callbacks cannot refund twice.
 */
function saveBattleCheckpoint(db: GameDb, id: number, state: BattleState) {
  if (state.status !== 'active' && state.status !== 'victory') {
    const hero = getHero(db);
    const spent = Math.max(0, hero.pushupUnitsSpent - (state.pushupUnitsSpent ?? 0));
    db.update(heroes).set({ pushupUnitsSpent: spent }).where(eq(heroes.id, 1)).run();
    state = { ...state, pushupUnits: getPushupUnits(db, spent) };
  }
  return db.update(dungeonRuns).set({ status: state.status, state }).where(eq(dungeonRuns.id, id)).returning().get();
}

export function expireBattles(db: GameDb, now = Date.now()) {
  db.transaction(tx => {
    const active = tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).all();
    for (const run of active) {
      if (run.state.day === localDay(now)) continue;
      saveBattleCheckpoint(tx, run.id, { ...run.state, status: 'expired', gold: 0, xp: 0,
        log: ['A new day begins. The unfinished bounty is lost and spent pushups are refunded. Start a fresh expedition.'] });
    }
  });
}

export function startDungeon(db: GameDb, dungeonId: number, now = Date.now()) {
  return db.transaction((tx) => {
    expireBattles(tx, now);
    const active = tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).get();
    if (active) return active;
    const hero = getHero(tx);
    if (!Number.isInteger(dungeonId) || !DUNGEONS[dungeonId] || dungeonId > hero.unlockedDungeon) throw new Error('Defeat the previous boss to unlock this dungeon.');
    const day = localDay(now);
    const stats = heroStats(hero, getFitnessDay(tx, day));
    const health = availableHealth(hero, stats.health, day);
    if (health <= 0) throw new Error('Your hero needs more health. Walk, drink a healing potion, upgrade armor, or return tomorrow.');
    const pushupUnits = getPushupUnits(tx, hero.pushupUnitsSpent);
    if (pushupUnits < attackCostUnits(stats.pushupCostUnits, hero.focusAttacks)) throw new Error('Train pushups to stockpile at least one attack before entering.');
    const state = beginBattle(dungeonId, day, stats, health, { pushupUnits, focusAttacks: hero.focusAttacks, meters: hero.combatMeters });
    return tx.insert(dungeonRuns).values({ startedAt: now, state, status: 'active' }).returning().get();
  });
}

/** Tick guard handles stale callbacks. Spending, meters, bounty, and checkpoint
 * share one transaction, including failures and the boss's final paid attack.
 */
export function advanceDungeon(db: GameDb, id: number, expectedTick: number, now = Date.now()) {
  return db.transaction((tx) => {
    expireBattles(tx, now);
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.status !== 'active' || run.state.tick !== expectedTick) return run;
    const hero = getHero(tx);
    const pushupUnits = getPushupUnits(tx, hero.pushupUnitsSpent);
    // Newly saved workouts can replenish a paused expedition. Gear/agility stay
    // fixed at entry; resource availability always comes from the database.
    const next = battleTurn({ ...run.state, pushupUnits });
    const spent = pushupUnits - next.pushupUnits;
    tx.update(heroes).set({ pushupUnitsSpent: hero.pushupUnitsSpent + spent,
      focusAttacks: next.focusAttacks, combatMeters: next.meters }).where(eq(heroes.id, 1)).run();
    if (next.status === 'victory') {
      // Award once in the same transaction as the final checkpoint. Level-up
      // health does not refill the hero on victory; the exact remaining HP stays.
      const maxHealth = heroStats({ ...hero, xp: hero.xp + next.xp }, getFitnessDay(tx, next.day)).health;
      tx.update(heroes).set({ gold: hero.gold + next.gold, xp: hero.xp + next.xp,
        unlockedDungeon: Math.max(hero.unlockedDungeon, Math.min(DUNGEONS.length - 1, next.dungeonId + 1)),
        damageDay: next.day, damageTaken: Math.max(0, maxHealth - next.heroHp),
      }).where(eq(heroes.id, 1)).run();
    }
    return saveBattleCheckpoint(tx, id, next);
  });
}

export function retreatDungeon(db: GameDb, id: number) {
  db.transaction(tx => {
    const run = tx.select().from(dungeonRuns).where(eq(dungeonRuns.id, id)).get();
    if (!run || run.status !== 'active') return;
    saveBattleCheckpoint(tx, id, { ...run.state, status: 'retreated', gold: 0, xp: 0,
      log: ['You return without loot. Entry health and spent pushups are restored. Used potion charges stay spent.'] });
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
    .groupBy(sql`date(${sets.endedAt} / 1000, 'unixepoch', 'localtime')`).all();
  const runTotals = db.select({ distance: sql<number>`coalesce(sum(${runs.distanceMeters}), 0)`.mapWith(Number),
    count: sql<number>`count(*)`.mapWith(Number) }).from(runs).get()!;
  const stats = heroStats(hero, today);
  const pushupUnits = getPushupUnits(db, hero.pushupUnitsSpent);
  const latestBattle = db.select().from(dungeonRuns).orderBy(desc(dungeonRuns.id)).limit(1).get() ?? null;
  const cost = latestBattle?.status === 'active' ? latestBattle.state.stats.pushupCostUnits : stats.pushupCostUnits;
  return {
    hero, today, history, stats, pushupUnits, attackCostUnits: attackCostUnits(cost, hero.focusAttacks),
    attacksAvailable: attacksAvailable(pushupUnits, cost, hero.focusAttacks),
    currentHealth: availableHealth(hero, stats.health, today.day),
    claimed: db.select().from(challengeClaims).where(eq(challengeClaims.day, today.day)).all().map((c) => c.challengeId),
    latestBattle,
    recentRuns: db.select().from(runs).where(gte(runs.day, history[0].day)).orderBy(desc(runs.createdAt)).all(),
    totals: { pushups: dailyReps.reduce((sum, r) => sum + r.total, 0), bestPushupDay: Math.max(0, ...dailyReps.map((r) => r.total)),
      distanceMeters: runTotals.distance, runs: runTotals.count },
  };
}
export type GameSnapshot = ReturnType<typeof getGameSnapshot>;
