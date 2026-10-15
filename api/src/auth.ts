// Private-v1 auth (intentionally lighter than public, per revised §0.9):
// email + password, PBKDF2-SHA-256 70k (owner's explicit temporary choice —
// public launches with Argon2id + rehash-on-login), opaque 256-bit session
// tokens stored ONLY as SHA-256 hashes, revocable server-side.
//
// Invariants (private §3): never serialize pass_salt/pass_hash to any
// response (DTO allowlists only); cookie __Host-cl_session HttpOnly Secure
// SameSite=Lax Path=/ with no Domain attribute.

import { randomBytes, randomUUID, timingSafeEqual, pbkdf2Sync, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export const PBKDF2_ITERATIONS = 70000;
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

// --- password hashing ------------------------------------------------------

export function hashPasswordSync(password: string): { salt: Buffer; hash: Buffer } {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return { salt, hash };
}

export function verifyPasswordSync(password: string, salt: Buffer, expected: Buffer): boolean {
  const actual = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function validateCredentials(email: string, password: string): string | null {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return 'invalid email';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'password must be at least 8 characters';
  }
  if (password.length > 256) return 'password too long';
  return null;
}

// --- sessions ----------------------------------------------------------------

const now = () => Date.now();

function sha256hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url'); // 256 bits, opaque
  return { token, tokenHash: sha256hex(token) };
}

export function createSession(db: Database.Database, userId: string): { token: string } {
  const { token, tokenHash } = newSessionToken();
  const t = now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, t, t + SESSION_TTL_MS);
  return { token };
}

export function findValidSessionUserId(db: Database.Database, token: string): string | null {
  const row = db.prepare('SELECT user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?')
    .get(sha256hex(token)) as { user_id: string; expires_at: number; revoked_at: number | null } | undefined;
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= now()) return null;
  return row.user_id;
}

/** Revoke one token, or all of a user's tokens (logout-all / password reset). */
export function revokeSession(db: Database.Database, token?: string | undefined, userId?: string | undefined): void {
  const t = now();
  if (token) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(
      t, sha256hex(token),
    );
  }
  if (userId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(t, userId);
  }
}

// --- cookie helpers -----------------------------------------------------------

export const SESSION_COOKIE = '__Host-cl_session';

const SESSION_COOKIE_AGE_S = Math.floor(SESSION_TTL_MS / 1000);

export function setSessionCookie(token: string): Record<string, string> {
  return {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_COOKIE_AGE_S}`,
  };
}

export function clearSessionCookie(): Record<string, string> {
  return { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` };
}

export function readSessionCookie(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  for (const part of headerValue.split(';')) {
    const kv = part.trim();
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    if (kv.slice(0, eq) === SESSION_COOKIE) {
      const val = kv.slice(eq + 1);
      return val || null;
    }
  }
  return null;
}

export { randomUUID };
