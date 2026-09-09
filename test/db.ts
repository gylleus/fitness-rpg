import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '../src/db/schema';
import journal from '../src/db/migrations/meta/_journal.json';

/**
 * An in-memory database built from the real migration SQL, so tests exercise the
 * same DDL the app ships rather than a hand-maintained copy that can drift.
 */
export function createTestDb(filename = ':memory:') {
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');

  for (const entry of journal.entries) {
    const migration = readFileSync(join(__dirname, `../src/db/migrations/${entry.tag}.sql`), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  return drizzle(sqlite, { schema });
}
