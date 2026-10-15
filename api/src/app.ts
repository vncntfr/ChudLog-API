// Hono app factory — the single entrypoint for Caddy (prod) or
// @hono/node-server (local dev). Mounts: security middleware, /api routes,
// PWA statics (the api serves the built frontend too — the VPS is one box).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { ChudEnv } from './env.js';
import type { DB } from './db.js';
import { readSessionCookie, findValidSessionUserId } from './auth.js';
import { rateLimitAllow } from './rate-limit.js';
import { badRequest } from './errors.js';
import { buildAuthRoutes } from './routes/auth.js';
import { buildExportRoutes } from './routes/export.js';
import { buildImportRoutes } from './routes/imports.js';
import { buildRoutineRoutes } from './routes/routines.js';
import { buildNotificationRoutes } from './routes/notifications.js';
import { buildCommunityRoutes } from './routes/community.js';
import { buildLogRoutes } from './routes/logs.js';
import { buildMeRoutes } from './routes/me.js';

export interface AppCtx {
  db: DB;
  env: ChudEnv;
}

export interface SessionUser {
  id: string;
  email: string;
}

type Variables = {
  User?: SessionUser;
};

export type { Variables };

function stripSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/**
 * CSRF/Origin rule (private spec §0.9/§4): a browser request carrying an
 * Origin header must be same-origin or explicitly allowed. Requests without
 * Origin (curl, non-browser) pass.
 */
export function originAllowed(c: Context, env: ChudEnv): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  const o = stripSlash(origin);
  if (o === env.publicOrigin) return true;
  return env.allowedOrigins.some((a) => stripSlash(a) === o);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStaticFile(staticRoot: string, urlPath: string): Response | null {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const target = resolve(join(staticRoot, rel));
  // traversal guard: must stay inside staticRoot
  if (!target.startsWith(resolve(staticRoot) + '/') && target !== resolve(staticRoot)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return new Response(readFileSync(target), {
    status: 200,
    headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
  });
}

export function buildApp(ctx: AppCtx): Hono<{ Variables: Variables }> {
  const { db, env } = ctx;
  const app = new Hono<{ Variables: Variables }>();

  app.use('*', secureHeaders({contentSecurityPolicy:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],workerSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'"]}}));
  if (env.nodeEnv !== 'test') app.use('*', logger());

  app.use('/api/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });

  // CORS: same-origin in prod; the Vite dev origin is allowed in dev.
  app.use('/api/*', cors({
    origin: (origin) => {
      const o = stripSlash(origin ?? '');
      if (o === env.publicOrigin) return o;
      if (env.allowedOrigins.some((a) => stripSlash(a) === o)) return o;
      return env.publicOrigin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key'],
    credentials: true,
    maxAge: 86400,
  }));

  // Body limits (public baseline): 256 KB JSON; 5 MB for CSV imports.
  app.use('/api/*', async (c, next) => bodyLimit({
    maxSize: c.req.path.startsWith('/api/gym/import/') ? 5 * 1024 * 1024 : 256 * 1024,
  })(c, next));

  // Origin check on ALL state-changing API routes (CSRF defense in depth).
  const originCheck = createMiddleware(async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !originAllowed(c, env)) {
      return c.json({ error: 'origin not allowed' }, 403);
    }
    await next();
  });
  app.use('/api/*', originCheck);

  // Auth middleware: opaque session cookie → user. Public: /api/auth/*,
  // /api/health, /api/meta. Everything else must be authenticated.
  const authCheck = createMiddleware(async (c, next) => {
    const path = new URL(c.req.url).pathname.replace(/\/+$/, '') || '/';
    const isPublic =
      path === '/api/health' || path === '/api/health/backup' || path === '/api/meta/vapid' || path.startsWith('/api/auth/');
    if (!isPublic) {
      const token = readSessionCookie(c.req.header('cookie'));
      if (!token) return c.json({ error: 'unauthenticated' }, 401);
      const userId = findValidSessionUserId(db.db, token);
      if (!userId) return c.json({ error: 'session expired or revoked — sign in again' }, 401);
      const row = db.db
        .prepare('SELECT id, email FROM users WHERE id = ?')
        .get(userId) as { id: string; email: string } | undefined;
      if (!row) return c.json({ error: 'unauthenticated' }, 401);
      if(!rateLimitAllow({key:`api:${userId}`,max:300,windowMs:3600000}))return c.json({error:'hourly request limit reached'},429);
      c.set('User', row);
    }
    await next();
  });
  app.use('/api/*', authCheck);

  // --- routes ----------------------------------------------------------------
  // Public meta (the VAPID public key is public by RFC 8292 design).
  const backupHealth = () => {
    const configured = Boolean(env.backupDirectory && env.backupKey);
    const successRaw = (db.db.prepare("SELECT value FROM meta WHERE key='backup:last_success'").get() as {value:string}|undefined)?.value;
    const failureRaw = (db.db.prepare("SELECT value FROM meta WHERE key='backup:last_failure'").get() as {value:string}|undefined)?.value;
    const lastSuccess = successRaw ? Number(successRaw) : null;
    const lastFailure = failureRaw ? Number(failureRaw) : null;
    const ageHours = lastSuccess === null ? null : Math.round(((Date.now() - lastSuccess) / 3_600_000) * 10) / 10;
    const status = !configured ? 'unconfigured'
      : lastFailure !== null && (lastSuccess === null || lastFailure > lastSuccess) ? 'failed'
      : lastSuccess === null ? 'pending'
      : ageHours !== null && ageHours > 36 ? 'stale'
      : 'ok';
    return { configured, status, last_success: lastSuccess, last_failure: lastFailure, age_hours: ageHours };
  };
  app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now(), backup: backupHealth() }));
  app.get('/api/health/backup', (c) => {
    const backup = backupHealth();
    const ok = backup.status === 'ok';
    return c.json({ ok, backup }, ok ? 200 : 503);
  });
  app.get('/api/meta/vapid', (c) => c.json({ vapidPublicKey: env.vapidPublicKey }));

  app.route('/api', buildAuthRoutes(ctx));
  app.route('/api', buildMeRoutes(ctx));
  app.route('/api', buildLogRoutes(ctx));
  app.route('/api', buildCommunityRoutes(ctx));
  app.route('/api', buildNotificationRoutes(ctx));
  app.route('/api', buildRoutineRoutes(ctx));
  app.route('/api', buildImportRoutes(ctx));
  app.route('/api', buildExportRoutes(ctx));

  // --- error handling (plain, specific client messages) -----------------------
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    const name = err instanceof Error ? err.name : '';
    const status = (err as { status?: number }).status;
    if (name === 'AppError' && status) {
      return c.json({ error: (err as Error).message }, status as 400 | 401 | 403 | 404 | 409 | 429);
    }
    if (name === 'ZodError') {
      return c.json({ error: 'invalid payload' }, 400);
    }
    const detail = env.nodeEnv === 'production' ? 'internal error' : (err as Error).message;
    console.error(err);
    return c.json({ error: detail }, 500);
  });

  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    throw badRequest('no such path');
  });

  // --- PWA statics (SPA: real files first, else index.html) --------------------
  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    if (existsSync(join(env.staticDir, 'index.html'))) {
      const direct = serveStaticFile(env.staticDir, path);
      if (direct) return direct;
      // SPA fallback → the PWA router takes over
      return new Response(readFileSync(join(env.staticDir, 'index.html')), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    throw badRequest('PWA not built — run `npm run build` in web/');
  });

  return app;
}
