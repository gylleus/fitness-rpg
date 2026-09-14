import { eq, gte } from 'drizzle-orm';
import type { GameDb } from '../db/game';
import { activityDays, healthConnections, runRecordings, runs } from '../db/schema';
import { dayStart, nextDailyReset, recentDays } from '../game/rules';
import type { RunSegment } from '../running/route';
import { healthAuthorized, healthName, readHealthSteps } from './native';

export const getHealthConnection = (db: GameDb) => db.select().from(healthConnections).where(eq(healthConnections.id, 1)).get();
export function setHealthConnected(db: GameDb, enabled: boolean) {
  db.insert(healthConnections).values({ id: 1, enabled }).onConflictDoUpdate({ target: healthConnections.id, set: { enabled } }).run();
}
export async function stepsInSegments(segments: RunSegment[], now = Date.now()) {
  let count = 0;
  for (const segment of segments) count += await readHealthSteps(segment.start, segment.end ?? now);
  return count;
}
let syncing: Promise<void> | null = null;
export function syncHealth(db: GameDb, now = Date.now()): Promise<void> {
  if (syncing) return syncing;
  syncing = sync(db, now).finally(() => { syncing = null; });
  return syncing;
}
async function sync(db: GameDb, now: number) {
  if (!getHealthConnection(db)?.enabled) return;
  if (!await healthAuthorized()) throw new Error(`Allow Fitness RPG to read steps in ${healthName}, then sync again.`);
  const days = recentDays(now);
  // Complete the reads before applying them, so a failed sync preserves the
  // previous complete snapshot. Native zero replaces legacy manual data too.
  const totals: { day: string; steps: number }[] = [];
  for (const day of days) {
    const start = dayStart(day), end = Math.min(nextDailyReset(start), now);
    totals.push({ day, steps: start < end ? await readHealthSteps(start, end) : 0 });
  }
  const updates: { id: number; steps: number }[] = [];
  for (const run of db.select().from(runs).where(gte(runs.day, days[0])).all()) {
    if (!run.recordingId) continue;
    const recording = db.select().from(runRecordings).where(eq(runRecordings.id, run.recordingId)).get();
    if (recording) updates.push({ id: run.id, steps: Math.max(recording.observedSteps, await stepsInSegments(recording.segments, now)) });
  }
  if (!getHealthConnection(db)?.enabled) return;
  db.transaction(tx => {
    for (const total of totals) {
      if (!Number.isSafeInteger(total.steps) || total.steps < 0) throw new Error('Invalid step total from the health service.');
      tx.insert(activityDays).values({ day: total.day, nativeSteps: total.steps, stepSource: healthName, syncedAt: now })
        .onConflictDoUpdate({ target: activityDays.day, set: { nativeSteps: total.steps, stepSource: healthName, syncedAt: now } }).run();
    }
    for (const run of updates) tx.update(runs).set({ steps: run.steps }).where(eq(runs.id, run.id)).run();
    tx.update(healthConnections).set({ syncedAt: now }).where(eq(healthConnections.id, 1)).run();
  });
}
