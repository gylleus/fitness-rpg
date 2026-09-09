/**
 * Local workout storage.
 *
 * Workout and activity tables stay game-agnostic. The separate hero, dungeon,
 * and challenge tables hold progression, so tuning the game never rewrites
 * exercise history — the data that cannot be regenerated.
 *
 * Written against drizzle's sqlite-core so the same schema runs on expo-sqlite in the
 * app and on better-sqlite3 in tests.
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { BattleState, BattleStatus } from '../game/combat';
import type { CombatMeters } from '../game/attacks';
import type { RunSegment } from '../running/route';

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Exercise slug. Only 'pushup' exists today; kept open for later movements. */
    exercise: text('exercise').notNull(),
    /** Idempotency key for saving a camera workout; null for older sessions. */
    sourceKey: text('source_key'),
    /** Unix epoch milliseconds. */
    startedAt: integer('started_at').notNull(),
    /** Null while a session is still in progress. */
    endedAt: integer('ended_at'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index('sessions_started_at_idx').on(t.startedAt), uniqueIndex('sessions_source_key_idx').on(t.sourceKey)],
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
  (t) => [index('sets_session_id_idx').on(t.sessionId), index('sets_ended_at_idx').on(t.endedAt)],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type WorkoutSet = typeof sets.$inferSelect;
export type NewWorkoutSet = typeof sets.$inferInsert;

export const activityDays = sqliteTable('activity_days', {
  day: text('day').primaryKey(),
  enteredSteps: integer('entered_steps').notNull().default(0),
  nativeSteps: integer('native_steps'),
  stepSource: text('step_source'),
  syncedAt: integer('synced_at'),
});

export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),
  source: text('source').notNull().default('manual'),
  sourceKey: text('source_key').notNull(),
  createdAt: integer('created_at').notNull(),
  distanceMeters: real('distance_meters').notNull(),
  durationSeconds: real('duration_seconds').notNull(),
  steps: integer('steps').notNull(),
  recordingId: text('recording_id'),
}, (t) => [index('runs_day_idx').on(t.day), uniqueIndex('runs_source_key_idx').on(t.sourceKey)]);

export const heroes = sqliteTable('heroes', {
  id: integer('id').primaryKey(),
  gold: integer('gold').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  swordLevel: integer('sword_level').notNull().default(0),
  armorLevel: integer('armor_level').notNull().default(0),
  unlockedDungeon: integer('unlocked_dungeon').notNull().default(0),
  damageDay: text('damage_day'),
  damageTaken: integer('damage_taken').notNull().default(0),
  pushupUnitsSpent: integer('pushup_units_spent').notNull().default(0),
  amuletOwned: integer('amulet_owned', { mode: 'boolean' }).notNull().default(false),
  healthPotions: integer('health_potions').notNull().default(0),
  focusPotions: integer('focus_potions').notNull().default(0),
  focusAttacks: integer('focus_attacks').notNull().default(0),
  combatMeters: text('combat_meters', { mode: 'json' }).$type<CombatMeters>().notNull().default({ dodge: 0, effects: {} }),
});

export const dungeonRuns = sqliteTable('dungeon_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  status: text('status').$type<BattleStatus>().notNull(),
  state: text('state', { mode: 'json' }).$type<BattleState>().notNull(),
});

export const challengeClaims = sqliteTable('challenge_claims', {
  day: text('day').notNull(),
  challengeId: text('challenge_id').notNull(),
}, (t) => [primaryKey({ columns: [t.day, t.challengeId] })]);

export const healthConnections = sqliteTable('health_connections', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  syncedAt: integer('synced_at'),
});

export const runRecordings = sqliteTable('run_recordings', {
  id: text('id').primaryKey(),
  status: text('status').$type<'recording' | 'paused' | 'finished' | 'discarded'>().notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  segments: text('segments', { mode: 'json' }).$type<RunSegment[]>().notNull(),
  distanceMeters: real('distance_meters').notNull().default(0),
  observedSteps: integer('observed_steps').notNull().default(0),
  lastFixAt: integer('last_fix_at'),
  error: text('error'),
});

export const routePoints = sqliteTable('route_points', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  recordingId: text('recording_id').notNull().references(() => runRecordings.id, { onDelete: 'cascade' }),
  timestamp: integer('timestamp').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  accuracy: real('accuracy').notNull(),
  altitude: real('altitude'),
  segment: integer('segment').notNull(),
  breakBefore: integer('break_before', { mode: 'boolean' }).notNull().default(false),
}, (t) => [index('route_recording_idx').on(t.recordingId), uniqueIndex('route_sample_idx').on(t.recordingId, t.timestamp)]);
