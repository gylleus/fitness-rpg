import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, it } from 'vitest';
import * as schema from './schema';
import journal from './migrations/meta/_journal.json';
import { getGameSnapshot, startDungeon } from './game';

it('retires old ammo-based runs without changing workouts, progression, health, items, or past results', () => {
  const sqlite = new Database(':memory:');
  const now = new Date(2026, 8, 10, 12).getTime();
  try {
    for (const entry of journal.entries.filter(entry => entry.idx < 5)) {
      sqlite.exec(readFileSync(join(__dirname, `migrations/${entry.tag}.sql`), 'utf8'));
    }
    sqlite.exec(`INSERT INTO heroes (id, gold, xp, pushup_units_spent, damage_day, damage_taken, focus_attacks, health_potions)
      VALUES (1, 53, 0, 900, '2026-09-10', 25, 3, 2);
      INSERT INTO sessions (id, exercise, started_at, ended_at) VALUES (1, 'pushup', ${now}, ${now});
      INSERT INTO sets (session_id, valid_reps, partial_reps, started_at, ended_at) VALUES (1, 20, 2, ${now}, ${now});`);
    const insert = sqlite.prepare('INSERT INTO dungeon_runs (started_at,status,state) VALUES (?,?,?)');
    const oldWin = JSON.stringify({ status: 'victory', gold: 70, xp: 85 });
    insert.run(now - 1, 'victory', oldWin);
    insert.run(now, 'active', JSON.stringify({ dungeonId: 0, day: '2026-09-10', status: 'active', gold: 20, xp: 30, entryHp: 75, heroHp: 50, pushupUnits: 1100 }));
    const heroBefore = sqlite.prepare('SELECT * FROM heroes').get();
    const migration = readFileSync(join(__dirname, 'migrations/0005_pushup_damage.sql'), 'utf8');
    sqlite.exec(migration);
    expect(sqlite.prepare('SELECT * FROM heroes').get()).toEqual(heroBefore);
    expect(sqlite.prepare('SELECT state FROM dungeon_runs WHERE id=1').get()).toEqual({ state: oldWin });
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0006_inventory.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0007_daily_fitness_reset.sql'), 'utf8'));
    sqlite.exec(readFileSync(join(__dirname, 'migrations/0008_camp_expeditions.sql'), 'utf8'));
    const db = drizzle(sqlite, { schema });
    expect(getGameSnapshot(db, now)).toMatchObject({ savedPushups: 20, currentHealth: 75,
      latestBattle: { status: 'retreated', state: { gold: 0, xp: 0 } }, today: { pushups: 20, partialReps: 2 } });
    const fresh = startDungeon(db, 0, now);
    expect(fresh.state).toMatchObject({ rulesVersion: 4, entryHp: 75, focusAttacks: 3, stats: { pushups: 20, attack: 75 } });
    sqlite.exec(migration);
    expect(getGameSnapshot(db, now).latestBattle).toEqual(fresh);
  } finally { sqlite.close(); }
});
