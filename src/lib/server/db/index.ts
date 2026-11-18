import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as schema from './schema.ts';
import { DATABASE_URL } from '$app/env/private';

const dbFile = resolve(DATABASE_URL.replace(/^(?:sqlite3?|file):(?:\/\/)?/, '') || 'data/santa.db');
mkdirSync(dirname(dbFile), { recursive: true });

const client = new Database(dbFile);
client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');

export const db = drizzle(client, { schema });

const envMigrations = process.env.MIGRATIONS_DIR ? resolve(process.env.MIGRATIONS_DIR) : null;
const migrationsFolder =
	envMigrations && existsSync(join(envMigrations, 'meta', '_journal.json'))
		? envMigrations
		: resolve('drizzle');

migrate(db, { migrationsFolder });

export { schema };
