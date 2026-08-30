/**
 * Local workout storage.
 *
 * Deliberately game-agnostic: there are no XP, level, or reward columns here. The RPG
 * layer will read from these tables and keep its own progression state, so tuning the
 * game later never requires migrating the tracking data — which is the part that is
 * expensive to lose and impossible to regenerate.
 *
 * Written against drizzle's sqlite-core so the same schema runs on expo-sqlite in the
 * app and on better-sqlite3 in tests.
 */

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Exercise slug. Only 'pushup' exists today; kept open for later movements. */
    exercise: text('exercise').notNull(),
    /** Unix epoch milliseconds. */
    startedAt: integer('started_at').notNull(),
    /** Null while a session is still in progress. */
    endedAt: integer('ended_at'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index('sessions_started_at_idx').on(t.startedAt)],
);

export const sets = sqliteTable(
  'sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** Reps that reached full depth. */
    validReps: integer('valid_reps').notNull().default(0),
    /** Descents that turned back before full depth — surfaced, never silently dropped. */
    partialReps: integer('partial_reps').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    /** Mean rep duration in ms, or null if no rep completed. */
    avgRepMs: real('avg_rep_ms'),
    /** JSON array of form flags observed during the set, e.g. ["hipSag"]. */
    formFlags: text('form_flags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (t) => [index('sets_session_id_idx').on(t.sessionId)],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type WorkoutSet = typeof sets.$inferSelect;
export type NewWorkoutSet = typeof sets.$inferInsert;
