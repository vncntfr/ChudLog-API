// Pure calendar math for ChudLog.
//
// Private v1: calendarTz is ALWAYS 'Asia/Jakarta' (WIB) for every user,
// regardless of travel or phone locale (master record decision).
// Public will pass configured IANA zones through the SAME functions —
// the zone is a parameter, the rules are identical.
//
// Critical: never derive a user's date from UTC (toISOString().slice(0,10)).
// The local calendar date in calendarTz is the accountability date.

import type { CalendarDate } from './types.js';

export const PRIVATE_TZ = 'Asia/Jakarta';

/** Validate a plausible IANA zone without throwing. */
export function isIanaTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Local calendar fields for an instant (unix ms) in a zone.
 * `minutesOfDay` = minutes past local midnight — the unit the sleep window
 * compares against (master record: compare minutes of day, not fractional
 * decimal hours).
 */
export function zonedInstant(epochMs: number, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(epochMs));

  const get = (t: string) => {
    const p = parts.find((x) => x.type === t);
    return p ? p.value : '';
  };

  const y = Number(get('year'));
  const mo = Number(get('month'));
  const d = Number(get('day'));
  let h = Number(get('hour'));
  if (h === 24) h = 0; // some Intl impls emit 24 for midnight
  const mi = Number(get('minute'));
  const wd = get('weekday');

  // ISO weekday: Mon=1 .. Sun=7
  const isoWeekday = wd
    ? { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd] ?? 7
    : 7;

  return {
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
    minutesOfDay: h * 60 + mi,
    isoWeekday,
    date: `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  };
}

/** Accountability date (local 'YYYY-MM-DD') for an instant. */
export function calendarDate(epochMs: number, timeZone: string): string {
  return zonedInstant(epochMs, timeZone).date;
}

/**
 * End of the local day for a calendar date, as a UTC instant.
 * A day's log closes at 00:00 local of the NEXT day (the exact WIB
 * midnight cutoff — 23:00 is only the last nudge).
 */
export function dayDeadline(date: string, timeZone: string): number {
  return localMidnight(shiftLocalDate(date, 1, timeZone), timeZone);
}

/**
 * Monday 00:00 (local) of the week containing the instant — the weekly
 * leaderboard reset boundary (private: Asia/Jakarta).
 * Implementation: local date of the instant, go back to Monday by
 * isoWeekday, then to local 00:00 via inverse scan.
 */
export function weekStartInstant(epochMs: number, timeZone: string): number {
  const today = zonedInstant(epochMs, timeZone);
  const backDays = today.isoWeekday - 1; // Mon=0
  const targetDate = shiftLocalDate(today.date, -backDays, timeZone);
  return localMidnight(targetDate, timeZone);
}

/**
 * 00:00 local of a given local calendar date, as a UTC instant.
 * Grid scan: local midnights sit on 15-minute boundaries for every current
 * IANA zone (all offsets are whole multiples of 15 minutes), so scanning the
 * 48h UTC window before/around the date at 15-min steps lands exactly.
 * The offset-method fallback covers exotic zones and DST-transition dates.
 */
export function localMidnight(date: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) throw new Error('bad date');

  const start = Date.UTC(y, mo - 1, d - 1, 12, 0, 0);
  for (let i = 0; i < 192; i++) {
    const ms = start + i * 15 * 60 * 1000;
    const z = zonedInstant(ms, timeZone);
    if (z.date === date && z.hour === 0 && z.minute === 0) return ms;
  }

  // Fallback: offset at local noon (exact for zero-DST zones like WIB).
  const noon = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const z = zonedInstant(noon, timeZone);
  return noon - offsetFromLocalDate(z, noon, timeZone) * 60 * 1000;
}

/**
 * UTC offset (minutes) of the zone AT a given instant — used only as a
 * last-resort fallback and for test assertions. Real product code should use
 * calendarDate()/dayDeadline(), not offsets.
 */
export function utcOffsetMinutes(epochMs: number, timeZone: string): number {
  const z = zonedInstant(epochMs, timeZone);
  return offsetFromLocalDate(z, epochMs, timeZone);
}

function offsetFromLocalDate(z: CalendarDate, epochMs: number, timeZone: string): number {
  // The instant's UTC fields vs the zone fields gives the total offset
  // including seconds alignment; we only need whole-minute offsets.
  const utc = new Date(epochMs);
  const utcMinutes = utc.getUTCDate() * 1440 + utc.getUTCHours() * 60 + utc.getUTCMinutes();
  const localMinutes = z.day * 1440 + z.hour * 60 + z.minute;
  let delta = localMinutes - utcMinutes;
  // Normalize into [-720, +720)
  while (delta >= 720) delta -= 1440;
  while (delta < -720) delta += 1440;
  return delta;
}

/** Add N days to a local calendar date (independent of month lengths via zone walk). */
export function shiftLocalDate(date: string, days: number, timeZone: string): string {
  let ms = localMidnight(date, timeZone) + days * 86400000;
  // days * 86400000 is exact for zero-offset zones (incl. Asia/Jakarta);
  // for DST zones land inside the target day and take the zone date.
  return zonedInstant(ms, timeZone).date;
}

/** 'YYYY-MM' month key in the zone (restore-month identity, seasons). */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Season id: 3-month cycles on Jan 1 / Apr 1 / Jul 1 / Oct 1 of the zone's
 * calendar (private: WIB dates). 'YYYY-Qn' where Q1=Jan..Mar.
 * Owned by season.ts; re-exported here so calendar callers don't break.
 */
export { seasonId } from './season.js';

/**
 * Is the instant inside [startOfLocalDate, endOfLocalDate) for the zone's
 * local calendar date? (On-time submission checks.)
 */
export function instantInLocalDay(epochMs: number, date: string, timeZone: string): boolean {
  return calendarDate(epochMs, timeZone) === date;
}

export interface NudgeWindow {
  tracker: 'sleep' | 'gym' | 'food' | 'morning';
  fromHour: number; // inclusive local hour the tracker becomes due
  toHour: number; // inclusive last nudge hour (23)
}

/**
 * Nudge due-hours (master record, locked): gym 08:00, sleep 08:00 (previous
 * night), food 13:00 — all local zone hours, last nudge 23:00. 23:00 is the
 * last PUSH; the day closes at 00:00.
 */
export const NUDGE_WINDOWS: NudgeWindow[] = [
  { tracker: 'sleep', fromHour: 8, toHour: 23 },
  { tracker: 'gym', fromHour: 8, toHour: 23 },
  { tracker: 'food', fromHour: 13, toHour: 23 },
];

export function isNudgeHourDue(tracker: 'sleep' | 'gym' | 'food', localHour: number): boolean {
  const w = NUDGE_WINDOWS.find((x) => x.tracker === tracker);
  if (!w) return false;
  return localHour >= w.fromHour && localHour <= w.toHour;
}
