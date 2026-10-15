import { openRuntime } from './runtime.js';
import { schemaVersion } from './db.js';
const { db } = openRuntime();
try { console.info(`Schema: ${schemaVersion(db.db)}`); } finally { db.close(); }
