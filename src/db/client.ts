/**
 * Database handle for the app. Tests do not use this module — they build a drizzle
 * instance over better-sqlite3 instead, so the repository functions stay runnable
 * on a laptop with no device attached.
 */

import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate, useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

export const DATABASE_NAME = 'fitness-rpg.db';

const expoDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

// Foreign keys are OFF by default in SQLite, so the cascade on sets.session_id
// would silently not fire without this.
expoDb.execSync('PRAGMA foreign_keys = ON;');
expoDb.execSync('PRAGMA journal_mode = WAL;');
expoDb.execSync('PRAGMA busy_timeout = 5000;');

export const db = drizzle(expoDb, { schema });
export type Database = typeof db;
let migrationPromise: Promise<void> | null = null;
export function ensureDatabaseReady() {
  return migrationPromise ??= migrate(db, migrations).catch(error => { migrationPromise = null; throw error; });
}

/**
 * Runs pending migrations on mount and reports progress.
 *
 * Screens must not query until `success` is true — on a cold start the tables do
 * not exist yet, and a read racing the migration fails rather than returning empty.
 */
export function useDatabaseMigrations() {
  return useMigrations(db, migrations);
}
