// SQLite connection + numbered transactional migration runner.
// Driver: better-sqlite3 (handoff §2) — synchronous, WAL, foreign keys ON.
// SQL stays plain SQLite 3: the same file later moves to the mini-PC
// unchanged (store-interface point).

import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type SQLiteDb = Database.Database;
export interface DB {
  db: SQLiteDb;
  path: string;
  close(): void;
}

export function openDb(dbPath: string): DB {
  const abs = resolve(dbPath);
  mkdirSync(dirname(abs), { recursive: true });
  const db = new Database(abs);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return { db, path: abs, close: () => db.close() };
}

/**
 * Apply migrations/NNNN_*.sql in numeric order, each inside ONE transaction
 * (better-sqlite3 is synchronous — BEGIN/COMMIT is one atomic step).
 * Applied files tracked in meta(key='migration:<file>'); idempotent at boot.
 */
export function runMigrations(db: SQLiteDb, migrationsDir: string): { applied: string[] } {
  const files = readdirSync(migrationsDir)
    .filter((f: string) => /^\d{4}_.*\.sql$/.test(f))
    .sort((a: string, b: string) => a.localeCompare(b));

  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const appliedNow: string[] = [];
  const check = db.prepare('SELECT key FROM meta WHERE key = ?');

  for (const file of files) {
    const row = check.get(`migration:${file}`);
    if (row) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(`migration:${file}`, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    appliedNow.push(file);
  }
  return { applied: appliedNow };
}

/** Latest applied migration label (e.g. '0001_init') or null. */
export function schemaVersion(db: SQLiteDb): string | null {
  const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'migration:%' ORDER BY key DESC LIMIT 1").all() as Array<{ key: string; value: string }>;
  if (!rows[0]) return null;
  return rows[0].key.slice('migration:'.length);
}
