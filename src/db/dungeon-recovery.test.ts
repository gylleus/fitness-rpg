import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test/db';
import * as schema from './schema';
import { dismissDungeonResult, getGameSnapshot, getHero, retreatDungeon, savePushupWorkout, startDungeon } from './game';
import journal from './migrations/meta/_journal.json';

const now = new Date(2026, 8, 10, 12).getTime();
const recoverySql = readFileSync(join(__dirname, 'migrations/0004_dungeon_recovery.sql'), 'utf8');

describe('legacy failed stockpile recovery', () => {
  it.each([
    { name: 'four full-price attacks', spent: 400, extra: null, restored: true },
    { name: 'discounted attacks', spent: 320, extra: null, restored: true },
    { name: 'a paid victory', spent: 400, extra: { status: 'victory', attacksMade: 1 }, restored: false },
    { name: 'an active run', spent: 400, extra: { status: 'active', attacksMade: 0 }, restored: false },
    { name: 'new refund accounting', spent: 400, extra: { status: 'defeat', attacksMade: 1, pushupUnitsSpent: 100 }, restored: false },
  ])('handles $name without guessing other spending', ({ spent, extra, restored }) => {
    const sqlite = new Database(':memory:');
    try {
      for (const entry of journal.entries.filter(entry => entry.idx < 4)) {
        sqlite.exec(readFileSync(join(__dirname, `migrations/${entry.tag}.sql`), 'utf8'));
      }
      sqlite.exec(`INSERT INTO heroes (id, gold, xp, sword_level, armor_level, unlocked_dungeon, damage_day, damage_taken, pushup_units_spent)
        VALUES (1, 53, 560, 4, 2, 1, '2026-09-06', 147, ${spent});
        INSERT INTO sessions (id, exercise, started_at, ended_at) VALUES (1, 'pushup', ${now}, ${now});
        INSERT INTO sets (session_id, valid_reps, partial_reps, started_at, ended_at) VALUES (1, 4, 2, ${now}, ${now});`);
      const insert = sqlite.prepare('INSERT INTO dungeon_runs (started_at, status, state) VALUES (?, ?, ?)');
      // Free-attack victories predate stockpile spending and must keep rewards.
      insert.run(now - 2, 'victory', JSON.stringify({ status: 'victory', gold: 70, xp: 85 }));
      insert.run(now - 1, 'defeat', JSON.stringify({ status: 'defeat', attacksMade: 4, pushupUnits: 0 }));
      if (extra) insert.run(now, extra.status, JSON.stringify(extra));
      const beforeHero = sqlite.prepare('SELECT * FROM heroes').get() as Record<string, unknown>;
      const beforeRuns = sqlite.prepare('SELECT id, started_at, status, state FROM dungeon_runs').all();
      sqlite.exec(recoverySql);
      expect(sqlite.prepare('SELECT * FROM heroes').get()).toEqual({ ...beforeHero, pushup_units_spent: restored ? 0 : spent });
      expect(sqlite.prepare('SELECT id, started_at, status, state FROM dungeon_runs').all()).toEqual(beforeRuns);
      expect(sqlite.prepare('SELECT valid_reps, partial_reps FROM sets').get()).toEqual({ valid_reps: 4, partial_reps: 2 });
      // Re-running the repair statement alone cannot grant a second refund.
      sqlite.exec(recoverySql.split('--> statement-breakpoint')[1]);
      expect(sqlite.prepare('SELECT pushup_units_spent FROM heroes').get()).toEqual({ pushup_units_spent: restored ? 0 : spent });
      if (restored) {
        for (const entry of journal.entries.filter(entry => entry.idx > 4)) sqlite.exec(readFileSync(join(__dirname, `migrations/${entry.tag}.sql`), 'utf8'));
        const db = drizzle(sqlite, { schema });
        const run = startDungeon(db, 0, now);
        expect(run.state).toMatchObject({ stats: { pushups: 4 }, heroHp: 165, dungeon: { name: 'Wetlands' } });
        expect(getHero(db)).toMatchObject({ gold: 53, xp: 560, swordLevel: 4, armorLevel: 2 });
      }
    } finally { sqlite.close(); }
  });
});

describe('dismissing expedition results', () => {
  it('keeps history and resources, hides older results, and allows a new expedition', () => {
    const db = createTestDb();
    try {
      savePushupWorkout(db, { sourceKey: 'reserve', startedAt: now - 60000, endedAt: now, validReps: 4, partialReps: 0 });
      const old = startDungeon(db, 0, now);
      retreatDungeon(db, old.id);
      const current = startDungeon(db, 0, now);
      expect(() => dismissDungeonResult(db, current.id, now)).toThrow('Finish or retreat');
      expect(getGameSnapshot(db, now).latestBattle?.id).toBe(current.id);
      retreatDungeon(db, current.id);
      const hero = getHero(db);
      dismissDungeonResult(db, current.id, now);
      dismissDungeonResult(db, current.id, now + 1);
      expect(getGameSnapshot(db, now)).toMatchObject({ latestBattle: null, savedPushups: 4, hero });
      const saved = db.select().from(schema.dungeonRuns).all();
      expect(saved).toHaveLength(2);
      expect(saved[1]).toMatchObject({ status: 'retreated', dismissedAt: now });
      const next = startDungeon(db, 0, now);
      expect(next.id).toBeGreaterThan(current.id);
      expect(next.state.dungeon?.name).toBe('Wetlands');
      expect(getGameSnapshot(db, now).latestBattle?.id).toBe(next.id);
    } finally { db.$client.close(); }
  });
});
