import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type { GameDb } from './game';
import { routePoints, runRecordings, runs } from './schema';
import { acceptFix, activeMilliseconds, type GpsFix } from '../running/route';
import { localDay } from '../game/rules';

export function activeRecording(db: GameDb) {
  return db.select().from(runRecordings).where(or(eq(runRecordings.status, 'recording'), eq(runRecordings.status, 'paused'))).get() ?? null;
}
export function getRecording(db: GameDb, id: string) {
  return db.select().from(runRecordings).where(eq(runRecordings.id, id)).get() ?? null;
}
export function getRoute(db: GameDb, id: string) {
  return db.select().from(routePoints).where(eq(routePoints.recordingId, id)).orderBy(asc(routePoints.timestamp)).all();
}
export function createRecording(db: GameDb, id: string, now = Date.now()) {
  return db.transaction(tx => {
    const existing = activeRecording(tx);
    if (existing) return existing;
    return tx.insert(runRecordings).values({ id, status: 'recording', startedAt: now, segments: [{ start: now, end: null }] }).returning().get();
  });
}
export function pauseRecording(db: GameDb, id: string, now = Date.now(), error: string | null = null) {
  return db.transaction(tx => {
    const row = getRecording(tx, id);
    if (!row || row.status !== 'recording') return row;
    const segments = row.segments.map(s => s.end === null ? { ...s, end: Math.max(s.start, now) } : s);
    return tx.update(runRecordings).set({ status: 'paused', segments, error }).where(eq(runRecordings.id, id)).returning().get();
  });
}
export function resumeRecording(db: GameDb, id: string, now = Date.now()) {
  return db.transaction(tx => {
    const row = getRecording(tx, id);
    if (!row || row.status !== 'paused') return row;
    return tx.update(runRecordings).set({ status: 'recording', error: null, segments: [...row.segments, { start: now, end: null }] }).where(eq(runRecordings.id, id)).returning().get();
  });
}
export function appendLocations(db: GameDb, id: string, fixes: GpsFix[], now = Date.now()) {
  return db.transaction(tx => {
    const row = getRecording(tx, id);
    if (!row || row.status !== 'recording') return;
    let previous = tx.select().from(routePoints).where(eq(routePoints.recordingId, id)).orderBy(desc(routePoints.timestamp)).get() ?? null;
    let distance = 0;
    let lastFixAt = row.lastFixAt;
    for (const fix of [...fixes].sort((a, b) => a.timestamp - b.timestamp)) {
      const accepted = acceptFix(fix, previous, row.segments, now);
      if (!accepted) continue;
      const inserted = tx.insert(routePoints).values({ ...accepted.point, recordingId: id }).onConflictDoNothing().returning().get();
      if (!inserted) continue;
      previous = inserted;
      distance += accepted.distance;
      lastFixAt = fix.timestamp;
    }
    tx.update(runRecordings).set({ distanceMeters: row.distanceMeters + distance, lastFixAt, error: null }).where(eq(runRecordings.id, id)).run();
  });
}
export function addObservedSteps(db: GameDb, id: string, delta: number) {
  if (!Number.isSafeInteger(delta) || delta <= 0 || delta > 200000) return;
  db.update(runRecordings).set({ observedSteps: sql`${runRecordings.observedSteps} + ${delta}` })
    .where(and(eq(runRecordings.id, id), eq(runRecordings.status, 'recording'))).run();
}
export function finishRecording(db: GameDb, id: string, nativeSteps: number | null, now = Date.now()) {
  return db.transaction(tx => {
    const row = getRecording(tx, id);
    if (!row) throw new Error('Run not found.');
    const previous = tx.select().from(runs).where(eq(runs.sourceKey, `gps:${id}`)).get();
    if (previous) return previous;
    if (row.status === 'discarded' || row.status === 'finished') throw new Error('This run has already ended.');
    const segments = row.segments.map(s => s.end === null ? { ...s, end: now } : s);
    const durationSeconds = activeMilliseconds(segments, now) / 1000;
    if (durationSeconds < 1 || row.distanceMeters < 1) throw new Error('No distance recorded yet. Move outdoors for a GPS fix, or discard this run.');
    const steps = Math.max(row.observedSteps, Number.isSafeInteger(nativeSteps) ? nativeSteps! : 0);
    const saved = tx.insert(runs).values({ day: localDay(now), source: 'gps', sourceKey: `gps:${id}`, recordingId: id,
      createdAt: now, distanceMeters: row.distanceMeters, durationSeconds, steps }).returning().get();
    tx.update(runRecordings).set({ status: 'finished', endedAt: now, segments, error: null }).where(eq(runRecordings.id, id)).run();
    return saved;
  });
}
export function discardRecording(db: GameDb, id: string, now = Date.now()) {
  const row = getRecording(db, id);
  if (!row || row.status === 'finished') return;
  db.update(runRecordings).set({ status: 'discarded', endedAt: now, segments: row.segments.map(s => s.end === null ? { ...s, end: now } : s) }).where(eq(runRecordings.id, id)).run();
  db.delete(routePoints).where(eq(routePoints.recordingId, id)).run();
}
