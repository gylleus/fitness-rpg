import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { dayStart, localDay, nextDailyReset } from '../game/rules';
import { deleteRun, getHero, type GameDb } from './game';
import { activeRecording } from './recordings';
import { activityDays, challengeClaims, dungeonRuns, healthConnections, heroes, runs, sessions, sets } from './schema';

/** Development only: erase this fitness day's activity without wiping the save. */
export function resetDailyData(db: GameDb, now = Date.now()) {
  if (!__DEV__) throw new Error('Daily data reset is only available in development builds.');
  const day = localDay(now), start = dayStart(day), end = nextDailyReset(start);
  db.transaction(tx => {
    if (activeRecording(tx)) throw new Error('Finish or discard your current run before resetting daily data.');

    const deleted = tx.delete(sets).where(and(gte(sets.endedAt, start), lt(sets.endedAt, end),
      inArray(sets.sessionId, tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.exercise, 'pushup')))))
      .returning({ sessionId: sets.sessionId }).all();
    // A session can contain sets from multiple days. Keep any remaining sets.
    for (const id of new Set(deleted.map(set => set.sessionId))) {
      if (!tx.select({ id: sets.id }).from(sets).where(eq(sets.sessionId, id)).get()) {
        tx.delete(sessions).where(eq(sessions.id, id)).run();
      }
    }
    for (const run of tx.select({ id: runs.id }).from(runs).where(eq(runs.day, day)).all()) deleteRun(tx, run.id);
    tx.delete(activityDays).where(eq(activityDays.day, day)).run();
    tx.delete(challengeClaims).where(eq(challengeClaims.day, day)).run();

    for (const run of tx.select().from(dungeonRuns).where(eq(dungeonRuns.status, 'active')).all()) {
      tx.update(dungeonRuns).set({ status: 'expired', state: { ...run.state, status: 'expired', gold: 0, xp: 0, loot: [],
        log: ['Daily data was reset for development. Start a fresh expedition.'] } }).where(eq(dungeonRuns.id, run.id)).run();
    }
    getHero(tx);
    tx.update(heroes).set({ damageDay: day, damageTaken: 0 }).where(eq(heroes.id, 1)).run();
    // An in-flight sync checks enabled before writing. Stay disconnected across
    // restarts so native step totals cannot immediately repopulate the reset day.
    tx.update(healthConnections).set({ enabled: false, syncedAt: null }).where(eq(healthConnections.id, 1)).run();
  });
}
