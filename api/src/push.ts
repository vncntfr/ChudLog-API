// Web Push (private handoff §8 — standards-correct, no crypto invention):
// maintained `web-push` library; VAPID = P-256 ES256 (RFC 8292); payload
// encryption ECDH P-256 / HKDF-SHA256 / aes128gcm (RFC 8291) is handled
// INSIDE the library. We configure keys once, validate subscriptions on
// write, bound retries, and clean up 404/410.

import webpush from 'web-push';
import type { ChudEnv } from './env.js';
import type { DB } from './db.js';
import { listPushTargets, removePushSub, pushTag, type PushTarget } from './settle.js';

/**
 * Accepts the VAPID private key as the raw base64url string from
 * generateVAPIDKeys(), or a JWK object/JSON string (defensive).
 */
export function configureWebPush(env: ChudEnv): 'configured' | 'missing-keys' {
  if (!env.vapidPublicKey || !env.vapidPrivateKeyJwk) {
    if (env.nodeEnv === 'production') {
      throw new Error('VAPID keys are required in production (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)');
    }
    return 'missing-keys';
  }
  let privateKey: string | object = env.vapidPrivateKeyJwk;
  const trimmed = env.vapidPrivateKeyJwk.trim();
  if (trimmed.startsWith('{')) {
    privateKey = JSON.parse(trimmed) as object;
  }
  webpush.setVapidDetails(env.vapidSub, env.vapidPublicKey, privateKey as string);
  return 'configured';
}

export interface NudgePayload {
  userId: string;
  localDate: string; // WIB (private)
  localHour: number;
  dueTrackers: string[]; // ordered: sleep, gym, food
  title: string;
  body: string;
  deepLink: string; // path within the app, e.g. '/gym'
}

export interface SendResult {
  sent: number;
  removed: number;
  errors: string[];
}

/**
 * Send ONE combined nudge to every active subscription of one user.
 * Per-endpoint delivery state is recorded by the caller in nudge_deliveries
 * (a retry for a failed phone must not resend to an accepted phone).
 */
export async function sendNudge(db: DB, n: NudgePayload): Promise<SendResult> {
  const subs = listPushTargets(db.db).filter((t) => t.userId === n.userId);
  if (subs.length === 0) return { sent: 0, removed: 0, errors: [] };

  const base = (typeof process !== 'undefined' && process.env?.PUBLIC_ORIGIN) || 'http://localhost:5173';
  const tag = pushTag(n.userId, n.localDate, n.localHour);
  const body = JSON.stringify({
    title: n.title,
    body: n.body,
    icon: '/icons/icon-192.png',
    tag, // coalesces one notification per user/hour
    renotify: true,
    data: { deepLink: n.deepLink, userId: n.userId, date: n.localDate, hour: n.localHour, trackers: n.dueTrackers },
  });
  void base;

  let sent = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, body, {
        TTL: 3600,
      });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        removePushSub(db.db, sub.endpoint);
        removed++;
      } else {
        // log class only — never the endpoint URL or auth key (privacy invariant)
        errors.push(`push error status=${status ?? 'unknown'}`);
      }
    }
  }
  return { sent, removed, errors };
}

export function frontendVapidKey(env: ChudEnv): string {
  return env.vapidPublicKey;
}

export type { PushTarget };
export { webpush };
