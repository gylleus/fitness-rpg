import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test/db';
import {
  endSession,
  getSession,
  listRecentSessions,
  recordSet,
  startSession,
  totalReps,
} from './sessions';
import { sessions, sets } from './schema';
import { eq } from 'drizzle-orm';

const T0 = 1_700_000_000_000;

describe('sessions', () => {
  it('starts a session that is open until ended', async () => {
    const db = createTestDb();
    const s = await startSession(db, 'pushup', T0);
    expect(s.id).toBeGreaterThan(0);
    expect(s.exercise).toBe('pushup');
    expect(s.endedAt).toBeNull();

    await endSession(db, s.id, T0 + 60_000);
    const found = await getSession(db, s.id);
    expect(found?.endedAt).toBe(T0 + 60_000);
  });

  it('rolls up reps across multiple sets', async () => {
    const db = createTestDb();
    const s = await startSession(db, 'pushup', T0);
    await recordSet(db, { sessionId: s.id, validReps: 10, partialReps: 1, startedAt: T0, endedAt: T0 + 30_000, avgRepMs: 2100 });
    await recordSet(db, { sessionId: s.id, validReps: 8, partialReps: 3, startedAt: T0 + 60_000, endedAt: T0 + 90_000, avgRepMs: 2400 });

    const summary = await getSession(db, s.id);
    expect(summary?.validReps).toBe(18);
    expect(summary?.partialReps).toBe(4);
    expect(summary?.setCount).toBe(2);
  });

  it('lists a session with no sets rather than hiding it', async () => {
    // An abandoned session is real history; omitting it would make the list lie.
    const db = createTestDb();
    await startSession(db, 'pushup', T0);
    const rows = await listRecentSessions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].validReps).toBe(0);
    expect(rows[0].setCount).toBe(0);
  });

  it('orders sessions newest first', async () => {
    const db = createTestDb();
    await startSession(db, 'pushup', T0);
    await startSession(db, 'pushup', T0 + 100_000);
    await startSession(db, 'pushup', T0 + 50_000);
    const rows = await listRecentSessions(db);
    expect(rows.map((r) => r.startedAt)).toEqual([T0 + 100_000, T0 + 50_000, T0]);
  });

  it('respects the limit', async () => {
    const db = createTestDb();
    for (let i = 0; i < 5; i++) await startSession(db, 'pushup', T0 + i * 1000);
    expect(await listRecentSessions(db, 3)).toHaveLength(3);
  });

  it('persists form flags as structured JSON, not a string', async () => {
    const db = createTestDb();
    const s = await startSession(db, 'pushup', T0);
    await recordSet(db, {
      sessionId: s.id, validReps: 5, partialReps: 0,
      startedAt: T0, endedAt: T0 + 20_000, formFlags: ['hipSag'],
    });
    const [row] = await db.select().from(sets).where(eq(sets.sessionId, s.id));
    expect(row.formFlags).toEqual(['hipSag']);
  });

  it('defaults avgRepMs to null when no rep completed', async () => {
    const db = createTestDb();
    const s = await startSession(db, 'pushup', T0);
    const set = await recordSet(db, { sessionId: s.id, validReps: 0, partialReps: 0, startedAt: T0, endedAt: T0 + 5000 });
    expect(set.avgRepMs).toBeNull();
  });
});

describe('totals', () => {
  it('is zero on an empty database rather than undefined', async () => {
    expect(await totalReps(createTestDb())).toEqual({ valid: 0, partial: 0 });
  });

  it('sums across sessions', async () => {
    const db = createTestDb();
    const a = await startSession(db, 'pushup', T0);
    const b = await startSession(db, 'pushup', T0 + 1000);
    await recordSet(db, { sessionId: a.id, validReps: 10, partialReps: 2, startedAt: T0, endedAt: T0 + 1 });
    await recordSet(db, { sessionId: b.id, validReps: 7, partialReps: 1, startedAt: T0, endedAt: T0 + 1 });
    expect(await totalReps(db)).toEqual({ valid: 17, partial: 3 });
  });
});

describe('referential integrity', () => {
  it('cascades set deletion when a session is removed', async () => {
    // Foreign keys are OFF by default in SQLite - this fails loudly if the
    // pragma is ever dropped from the app's client setup.
    const db = createTestDb();
    const s = await startSession(db, 'pushup', T0);
    await recordSet(db, { sessionId: s.id, validReps: 5, partialReps: 0, startedAt: T0, endedAt: T0 + 1 });
    await db.delete(sessions).where(eq(sessions.id, s.id));
    expect(await db.select().from(sets)).toHaveLength(0);
  });

  it('rejects a set pointing at a session that does not exist', async () => {
    const db = createTestDb();
    await expect(
      recordSet(db, { sessionId: 9999, validReps: 1, partialReps: 0, startedAt: T0, endedAt: T0 + 1 }),
    ).rejects.toThrow();
  });
});
