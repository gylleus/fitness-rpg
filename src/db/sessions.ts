/**
 * Workout persistence.
 *
 * Every function takes the database explicitly rather than importing the app's
 * singleton, so tests can pass a better-sqlite3-backed instance and run in Node.
 */

import { desc, eq, sql } from 'drizzle-orm';
import { sessions, sets, type Session, type WorkoutSet } from './schema';

// The drizzle driver types differ between expo-sqlite and better-sqlite3 while the
// query builders themselves are identical, so the handle is taken loosely typed.
// The schema still gives full type safety on the columns and the returned rows.
type AnyDb = any;

export async function startSession(db: AnyDb, exercise = 'pushup', now = Date.now()): Promise<Session> {
  const [row] = await db.insert(sessions).values({ exercise, startedAt: now }).returning();
  return row;
}

export async function endSession(db: AnyDb, sessionId: number, now = Date.now()): Promise<void> {
  await db.update(sessions).set({ endedAt: now }).where(eq(sessions.id, sessionId));
}

export type RecordSetInput = {
  sessionId: number;
  validReps: number;
  partialReps: number;
  startedAt: number;
  endedAt: number;
  avgRepMs?: number | null;
  formFlags?: string[];
};

export async function recordSet(db: AnyDb, input: RecordSetInput): Promise<WorkoutSet> {
  const [row] = await db
    .insert(sets)
    .values({
      sessionId: input.sessionId,
      validReps: input.validReps,
      partialReps: input.partialReps,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      avgRepMs: input.avgRepMs ?? null,
      formFlags: input.formFlags ?? [],
    })
    .returning();
  return row;
}

export type SessionSummary = Session & {
  validReps: number;
  partialReps: number;
  setCount: number;
};

/**
 * Recent sessions with their rep totals rolled up.
 *
 * Uses a left join so a session with no sets still appears — a session that was
 * started and abandoned is real history, and hiding it would make the list lie
 * about what happened.
 */
export async function listRecentSessions(db: AnyDb, limit = 20): Promise<SessionSummary[]> {
  return db
    .select({
      id: sessions.id,
      exercise: sessions.exercise,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      createdAt: sessions.createdAt,
      validReps: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number),
      partialReps: sql<number>`coalesce(sum(${sets.partialReps}), 0)`.mapWith(Number),
      setCount: sql<number>`count(${sets.id})`.mapWith(Number),
    })
    .from(sessions)
    .leftJoin(sets, eq(sets.sessionId, sessions.id))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
}

export async function totalReps(db: AnyDb): Promise<{ valid: number; partial: number }> {
  const [row] = await db
    .select({
      valid: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number),
      partial: sql<number>`coalesce(sum(${sets.partialReps}), 0)`.mapWith(Number),
    })
    .from(sets);
  return row ?? { valid: 0, partial: 0 };
}

export async function getSession(db: AnyDb, id: number): Promise<SessionSummary | undefined> {
  const [row] = await db
    .select({
      id: sessions.id,
      exercise: sessions.exercise,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      createdAt: sessions.createdAt,
      validReps: sql<number>`coalesce(sum(${sets.validReps}), 0)`.mapWith(Number),
      partialReps: sql<number>`coalesce(sum(${sets.partialReps}), 0)`.mapWith(Number),
      setCount: sql<number>`count(${sets.id})`.mapWith(Number),
    })
    .from(sessions)
    .leftJoin(sets, eq(sets.sessionId, sessions.id))
    .where(eq(sessions.id, id))
    .groupBy(sessions.id);
  return row;
}
