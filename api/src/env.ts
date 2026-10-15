// Small env loader — no dotenv dependency. Reads CWD .env if present;
// process.env always wins. Values are trimmed; empty values become undefined.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvFile(text: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && val !== '') out[key] = val;
  }
  return out;
}

export interface ChudEnv {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  dbPath: string;
  sessionSecret: string;
  allowedOrigins: string[]; // explicit origins (dev vite :5173, public origin). Empty ⇒ same-origin strict.
  publicOrigin: string; // origin the app is published under (also CORS/CSRF-allowed)
  vapidPublicKey: string; // Base64URL — safe to expose to the frontend
  vapidPrivateKeyJwk: string; // server-side only
  vapidAdminEmail: string;
  vapidSub: string;
  adminEmails: Set<string>;
  /** Directory of built PWA statics to serve alongside the API (optional). */
  staticDir: string;
  backupDirectory?: string;
  backupKey?: string;
}

export function loadEnv(cwd = process.cwd()): ChudEnv {
  let file: Record<string, string | undefined> = {};
  const p = resolve(cwd, '.env');
  if (existsSync(p)) file = parseEnvFile(readFileSync(p, 'utf8'));
  const v = (k: string): string | undefined => process.env[k] ?? file[k];

  const nodeEnv = (v('NODE_ENV') ?? 'development') as ChudEnv['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error(`bad NODE_ENV: ${nodeEnv}`);

  const sessionSecret = v('SESSION_SECRET') ?? '';
  if (nodeEnv === 'production') {
    if (sessionSecret === 'CHANGE_ME' || Buffer.byteLength(sessionSecret, 'utf8') < 32) throw new Error('SESSION_SECRET must be >= 32 bytes in production');
  } else if (!sessionSecret || sessionSecret === 'CHANGE_ME') {
    throw new Error('SESSION_SECRET is required (copy .env.example to .env and set a real value)');
  }

  const origins = (v('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const publicOrigin = (v('PUBLIC_ORIGIN') ?? `http://${v('HOST') ?? '127.0.0.1'}:${v('PORT') ?? 8787}`).replace(/\/$/, '');
  const vapidPublicKey = v('VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivateKeyJwk = v('VAPID_PRIVATE_KEY') ?? '';
  const backupDirectory = v('BACKUP_DIRECTORY');
  const backupKey = v('BACKUP_ENCRYPTION_KEY');
  if (nodeEnv === 'production') {
    let published: URL;
    try { published = new URL(publicOrigin); } catch { throw new Error('PUBLIC_ORIGIN must be an absolute URL in production'); }
    if (published.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use https in production');
    if (!vapidPublicKey || !vapidPrivateKeyJwk) throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required in production');
    if (!backupDirectory || !backupKey) throw new Error('BACKUP_DIRECTORY and BACKUP_ENCRYPTION_KEY are required in production');
  }
  if (Boolean(backupDirectory) !== Boolean(backupKey)) throw new Error('BACKUP_DIRECTORY and BACKUP_ENCRYPTION_KEY must be configured together');
  if (backupKey && Buffer.from(backupKey, 'base64').length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must encode exactly 32 bytes');

  return {
    nodeEnv,
    ...(backupDirectory ? {backupDirectory:resolve(cwd,backupDirectory)} : {}),
    ...(backupKey ? {backupKey} : {}),
    port: Number(v('PORT') ?? 8787),
    host: v('HOST') ?? '127.0.0.1',
    dbPath: resolve(cwd, v('DB_PATH') ?? './data/chudlog.db'),
    sessionSecret,
    allowedOrigins: origins,
    publicOrigin,
    vapidPublicKey,
    vapidPrivateKeyJwk,
    vapidAdminEmail: v('VAPID_ADMIN_EMAIL') ?? 'admin@localhost',
    vapidSub: v('VAPID_SUB') ?? 'mailto:admin@localhost',
    adminEmails: new Set((v('ADMIN_EMAILS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
    staticDir: v('STATIC_DIR') ?? resolve(cwd, 'web/dist'),
  };
}
