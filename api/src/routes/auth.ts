import { Hono, type Context } from 'hono';
import { randomUUID, randomInt } from 'node:crypto';
import type { AppCtx, Variables } from '../app.js';
import { hashPasswordSync, verifyPasswordSync, createSession, revokeSession, setSessionCookie, clearSessionCookie, readSessionCookie } from '../auth.js';
import { z } from 'zod';
import { consumeReset } from '../recovery.js';
import { registerSchema, loginSchema, passwordSchema } from '../schemas.js';
import { tooMany, conflict, notFound } from '../errors.js';
import { rateLimitAllow } from '../rate-limit.js';
import { settleUserFrom, todayWib } from '../settle.js';

type Env = { Variables: Variables };
export function buildAuthRoutes({ db }: AppCtx): Hono<Env> {
  const app = new Hono<Env>();
  const dummy = hashPasswordSync(randomUUID());
  function limit(c: Context<Env>, kind: string) {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!rateLimitAllow({ key: `auth:${kind}:${ip}`, max: 12, windowMs: 900000 })) throw tooMany('too many attempts; try again later');
  }
  app.post('/auth/register', async c => {
    limit(c, 'register');
    const parsed = registerSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid payload' }, 400);
    const input = parsed.data;
    const password = hashPasswordSync(input.password);
    const user = { id: randomUUID(), email: input.email };
    const now = Date.now();
    const token = db.db.transaction(() => {
      if (db.db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)) throw conflict('email already registered');
      let groupId: string = randomUUID();
      if (input.group_join) {
        const group = db.db.prepare('SELECT id, max_members FROM groups WHERE invite_code = ?').get(input.group_join.code) as { id: string; max_members: number } | undefined;
        if (!group) throw notFound('invite code not recognized');
        groupId = group.id;
        const members = db.db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(groupId) as { n: number };
        if (members.n >= group.max_members) throw conflict('group is full');
      }
      db.db.prepare('INSERT INTO users (id,email,pass_salt,pass_hash,display_name,created_at) VALUES (?,?,?,?,?,?)').run(user.id, user.email, password.salt, password.hash, input.display_name, now);
      if (input.group_create) {
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
        db.db.prepare('INSERT INTO groups (id,name,invite_code,created_by,created_at) VALUES (?,?,?,?,?)').run(groupId, input.group_create.name, code, user.id, now);
      }
      db.db.prepare('INSERT INTO group_members (group_id,user_id,joined_at) VALUES (?,?,?)').run(groupId, user.id, now);
      db.db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(user.id);
      settleUserFrom(db.db, user.id, todayWib(now), now);
      return createSession(db.db, user.id).token;
    }).immediate();
    return c.json({ user }, 201, setSessionCookie(token));
  });
  app.post('/auth/login', async c => {
    limit(c, 'login');
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: 'invalid email or password' }, 400);
    const row = db.db.prepare('SELECT id,email,pass_salt,pass_hash FROM users WHERE email = ?').get(parsed.data.email) as { id: string; email: string; pass_salt: Buffer; pass_hash: Buffer } | undefined;
    const valid = verifyPasswordSync(parsed.data.password, row?.pass_salt ?? dummy.salt, row?.pass_hash ?? dummy.hash);
    if (!row || !valid) return c.json({ error: 'invalid email or password' }, 401);
    const previous = readSessionCookie(c.req.header('cookie'));
    if (previous) revokeSession(db.db, previous);
    const { token } = createSession(db.db, row.id);
    return c.json({ user: { id: row.id, email: row.email } }, 200, setSessionCookie(token));
  });
  app.post('/auth/reset',async c=>{
    limit(c,'reset');
    const input=z.object({token:z.string().min(40).max(128),password:passwordSchema}).strict().safeParse(await c.req.json().catch(()=>undefined));
    if(!input.success)return c.json({error:'invalid recovery payload'},400);
    consumeReset(db.db,input.data.token,input.data.password);
    return c.json({ok:true},200,clearSessionCookie());
  });
  app.post('/auth/logout', c => {
    const token = readSessionCookie(c.req.header('cookie'));
    if (token) revokeSession(db.db, token);
    return c.json({ ok: true }, 200, clearSessionCookie());
  });
  return app;
}
