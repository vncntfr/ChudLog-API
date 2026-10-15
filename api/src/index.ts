import { startBackupWorker } from './backup-worker.js';
import { startNudgeWorker } from './nudges.js';
import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { openRuntime } from './runtime.js';

const ctx = openRuntime();
const stopWorker = startNudgeWorker(ctx);
const stopBackup = startBackupWorker(ctx);
const server = serve({ fetch: buildApp(ctx).fetch, hostname: ctx.env.host, port: ctx.env.port }, info => {
  console.info(`ChudLog listening on ${ctx.env.host}:${info.port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {stopWorker();stopBackup();server.close(() => { ctx.db.close(); process.exit(0); });});
}
