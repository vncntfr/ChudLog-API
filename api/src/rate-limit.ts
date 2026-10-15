// In-memory fixed-window rate limiter (private v1: tiny app, 10 users).
// Keyed on IP + bucket. Process-restart resets counters — acceptable and
// documented for a 10-person pilot; the window is short enough that brute
// force is still bounded. Public v1 replaces this with a durable store.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// housekeeping: drop stale windows on a timer (unref'd — never blocks exit)
if (typeof setImmediate === 'function') {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, w] of windows) {
      if (w.resetAt < now) windows.delete(k);
    }
  }, 60_000);
  t.unref();
}

/**
 * @returns true when the request is allowed, false when over budget.
 */
export function rateLimitAllow(opts: {
  key: string;
  max: number;
  windowMs: number;
  nowMs?: number;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  const w = windows.get(opts.key);
  if (!w || w.resetAt <= now) {
    windows.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return true;
  }
  if (w.count >= opts.max) return false;
  w.count += 1;
  return true;
}

/** Test helper. */
export function rateLimitReset(): void {
  windows.clear();
}
