import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { openDb, runMigrations } from './db.js';

export function openRuntime() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(root);
  const db = openDb(env.dbPath);
  try {
    runMigrations(db.db, fileURLToPath(new URL('./migrations/', import.meta.url)));
    return { env, db };
  } catch (error) { db.close(); throw error; }
}
