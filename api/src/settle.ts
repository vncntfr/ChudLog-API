// Rebuild projections from source history. Never seed a replay from mutable rank_state.
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { calendar, points as pointsLib, season as seasonLib } from '@chudlog/shared';
export type DbLike = Database.Database;
export type TrackerKey = 'food' | 'sleep' | 'gym';
const TZ = calendar.PRIVATE_TZ;
export interface SettleOpts { fromDate: string; toDate: string; nowMs?: number | undefined }
export function todayWib(nowMs = Date.now()): string { return calendar.calendarDate(nowMs, TZ); }
export function settleUserFrom(db: DbLike, userId: string, fromDate: string, nowMs = Date.now()): void {
  rebuildDayWindow(db, userId, { fromDate, toDate: todayWib(nowMs), nowMs });
}
export function rebuildDayWindow(db: DbLike, userId: string, opts: SettleOpts): void {
  for (const date of [opts.fromDate, opts.toDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('settle: bad date');
  }
  if (opts.fromDate > opts.toDate) return;
  const nowMs = opts.nowMs ?? Date.now();
  db.transaction(() => {
    const first = db.prepare(`SELECT MIN(date) AS date FROM (
      SELECT date FROM meals WHERE user_id = ? UNION ALL SELECT date FROM sleep WHERE user_id = ?
      UNION ALL SELECT date FROM workouts WHERE user_id = ? UNION ALL SELECT date FROM day_log WHERE user_id = ?
    )`).get(userId,userId,userId,userId) as { date: string | null };
    const start = first.date && first.date < opts.fromDate ? first.date : opts.fromDate;
    const restores = new Set((db.prepare('SELECT date FROM restores WHERE user_id=?').all(userId) as {date:string}[]).map(row=>row.date));
    let previousRealLit = false;
    function realLitOn(date:string) {
      const deadline=calendar.dayDeadline(date,TZ);
      return Boolean(db.prepare(`SELECT 1 WHERE
        EXISTS(SELECT 1 FROM meals m JOIN meal_rows r ON r.meal_id=m.id WHERE m.user_id=? AND m.date=? AND COALESCE(r.submitted_at,m.submitted_at)<?)
        AND EXISTS(SELECT 1 FROM sleep WHERE user_id=? AND date=? AND submitted_at<?)
        AND EXISTS(SELECT 1 FROM workouts w WHERE w.user_id=? AND w.date=? AND w.submitted_at<? AND (w.kind='rest' OR EXISTS(SELECT 1 FROM exercise_sets s WHERE s.workout_id=w.id AND s.is_working=1 AND s.reps>=1)))`)
        .get(userId,date,deadline,userId,date,deadline,userId,date,deadline));
    }
    let streak = 0, longest = 0, longestDate: string | null = null, lastLit: string | null = null;
    let lifetime = 0, seasonScore = 0, activeSeason = seasonLib.seasonId(start);
    const upsert = db.prepare(`INSERT INTO day_log (user_id,date,calendar_tz,food,sleep,gym,lit,restore_used,points_earned)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET food=excluded.food,sleep=excluded.sleep,
      gym=excluded.gym,lit=excluded.lit,restore_used=excluded.restore_used,points_earned=excluded.points_earned`);
    for (let d = start; d <= opts.toDate; d = calendar.shiftLocalDate(d,1,TZ)) {
      const deadline = calendar.dayDeadline(d,TZ);
      const foodRow = db.prepare(`SELECT MIN(COALESCE(r.submitted_at,m.submitted_at)) AS ts FROM meals m JOIN meal_rows r ON r.meal_id=m.id WHERE m.user_id=? AND m.date=?`).get(userId,d) as { ts: number | null };
      const sleepRow = db.prepare('SELECT submitted_at AS ts FROM sleep WHERE user_id=? AND date=?').get(userId,d) as { ts: number } | undefined;
      const gymRow = db.prepare(`SELECT w.kind,w.submitted_at AS ts,COALESCE(w.qualified_at,w.submitted_at) AS qualified_at,
        EXISTS(SELECT 1 FROM exercise_sets s WHERE s.workout_id=w.id AND s.is_working=1 AND s.reps>=1) AS valid
        FROM workouts w WHERE w.user_id=? AND w.date=?`).get(userId,d) as { kind: string; ts: number; qualified_at: number; valid: number } | undefined;
      const food = foodRow.ts !== null, sleep = !!sleepRow, gym = !!gymRow && (gymRow.kind === 'rest' || !!gymRow.valid);
      const lit = food && sleep && gym && foodRow.ts! < deadline && sleepRow!.ts < deadline && gymRow!.ts < deadline;
      const bridge = !lit && previousRealLit && restores.has(d) && calendar.shiftLocalDate(d,1,TZ)<=opts.toDate && realLitOn(calendar.shiftLocalDate(d,1,TZ));
      if (lit) { streak++; lastLit = d; }
      else if (!bridge && (d < todayWib(nowMs) || nowMs >= deadline)) { streak = 0; lastLit = null; }
      if (streak > longest) { longest = streak; longestDate = d; }
      const pts = pointsLib.pointsForWorkoutDay({ hasQualifyingWorkout: !!gymRow && gymRow.kind === 'workout' && !!gymRow.valid && gymRow.qualified_at < deadline,
        dayIsLit: lit, streakAfter: lit ? streak : 0, alreadyEarnedToday: false });
      const season = seasonLib.seasonId(d);
      if (season !== activeSeason) { seasonScore = seasonLib.seasonCarryover(seasonScore); activeSeason = season; }
      seasonScore += pts; lifetime += pts;
      upsert.run(userId,d,TZ,Number(food),Number(sleep),Number(gym),Number(lit),Number(bridge),pts);
      previousRealLit=lit;
    }
    db.prepare(`INSERT INTO rank_state (user_id,current_streak,longest_streak,longest_streak_date,lifetime_points,lifetime_tier,season_id,season_points,season_tier,streak_last_date,last_activity_ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET current_streak=excluded.current_streak,
      longest_streak=excluded.longest_streak,longest_streak_date=excluded.longest_streak_date,lifetime_points=excluded.lifetime_points,
      lifetime_tier=excluded.lifetime_tier,season_id=excluded.season_id,season_points=excluded.season_points,
      season_tier=excluded.season_tier,streak_last_date=excluded.streak_last_date,last_activity_ts=excluded.last_activity_ts`)
      .run(userId,streak,longest,longestDate,lifetime,pointsLib.tierFor(lifetime),activeSeason,seasonScore,pointsLib.tierFor(seasonScore),lastLit,(db.prepare(`SELECT MAX(ts) AS ts FROM (SELECT created_at AS ts FROM users WHERE id=? UNION ALL SELECT submitted_at FROM meals WHERE user_id=? UNION ALL SELECT submitted_at FROM sleep WHERE user_id=? UNION ALL SELECT submitted_at FROM workouts WHERE user_id=? UNION ALL SELECT occurred_at FROM log_events WHERE user_id=?)`).get(userId,userId,userId,userId,userId) as {ts:number}).ts);
  }).immediate();
}

// --------------------------------------------------------------------------
// Audit (log_events — append-only, server-authored)
// --------------------------------------------------------------------------

export function appendLogEvent(
  db: DbLike,
  params: {
    userId: string;
    entityType: string;
    entityId: string;
    action:
      | 'create'
      | 'update'
      | 'delete'
      | 'rest-replace'
      | 'import'
      | 'restore'
      | 'admin-correction';
    date: string;
    idempotencyKey?: string;
    occurredAt?: number;
  },
): void {
  const nowMs = params.occurredAt ?? Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO log_events
       (id, user_id, entity_type, entity_id, action, occurred_at, date, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    params.userId,
    params.entityType,
    params.entityId,
    params.action,
    nowMs,
    params.date,
    params.idempotencyKey ?? null,
  );
}

/** True if this (user, key) already produced an event → replay detected. */
export function hasEventId(db: DbLike, userId: string, idempotencyKey: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 AS x FROM log_events WHERE user_id = ? AND idempotency_key = ? LIMIT 1')
      .get(userId, idempotencyKey),
  );
}

// --------------------------------------------------------------------------
// Push fan-out plumbing (durable per-endpoint jobs land with the nudge
// engine — week 3)
// --------------------------------------------------------------------------

export interface PushTarget {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function listPushTargets(db: DbLike): PushTarget[] {
  const rows = db
    .prepare('SELECT user_id, endpoint, p256dh, auth FROM push_subs')
    .all() as Array<{ user_id: string; endpoint: string; p256dh: string; auth: string }>;
  return rows.map((r) => ({
    userId: r.user_id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
  }));
}

export function removePushSub(db: DbLike, endpoint: string): void {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
  db.prepare('DELETE FROM nudge_deliveries WHERE endpoint = ?').run(endpoint);
}

/**
 * Stable notification tag: coalesces one nudge per user/date/hour on the
 * client (replaces hourly notifications within the same hour).
 */
export function pushTag(userId: string, date: string, hour: number): string {
  return [userId, date, String(hour)].join(':');
}
