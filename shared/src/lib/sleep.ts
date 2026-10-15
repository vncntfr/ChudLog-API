// Pure sleep scoring (master record, locked).
//
// These are deliberately HARSH ChudLog product categories, not a medical
// diagnosis (string-audit lane: "product scoring"). A red or yellow entry
// still COUNTS as sleep-logged — color never fails a day; a MISSING entry
// does.
//
// Windows are INCLUSIVE and compared in minutes-of-day, not fractional
// decimal hours:
//   bed  21:00 .. 01:30 (inclusive at both ends, across midnight)
//   wake 04:30 .. 09:30 (inclusive at both ends)
// duration 420 .. 600 minutes (7–10 h inclusive)

import type { SleepColor } from './types.js';

export interface SleepInput {
  bedTs: number; // unix ms, absolute
  wakeTs: number; // unix ms, absolute, > bedTs
  /** local minutes-of-day for bed (0..1439), computed by the caller via zonedInstant(bedTs, tz) */
  bedMinutesOfDay: number;
  /** local minutes-of-day for wake (0..1439) */
  wakeMinutesOfDay: number;
}

export const GREEN_MIN_DURATION = 420;
export const GREEN_MAX_DURATION = 600;

const BED_OPEN = 21 * 60; // 1260 (21:00)
const BED_CLOSE = 1 * 60 + 30; // 90 (01:30)
const WAKE_OPEN = 4 * 60 + 30; // 270 (04:30)
const WAKE_CLOSE = 9 * 60 + 30; // 570 (09:30)

/** Bedtime is "in the good window" when minutes-of-day is in [21:00..23:59] ∪ [00:00..01:30], both ends inclusive. */
export function bedInWindow(mins: number): boolean {
  return (mins >= BED_OPEN && mins <= 1439) || (mins >= 0 && mins <= BED_CLOSE);
}

export function wakeInWindow(mins: number): boolean {
  return mins >= WAKE_OPEN && mins <= WAKE_CLOSE;
}

/** Duration in whole minutes, floored. (7h 4m 30s → 424.) */
export function durationMinutes(bedTs: number, wakeTs: number): number {
  const ms = wakeTs - bedTs;
  return Math.floor(ms / 60000);
}

export function isValidSleepInput(bedTs: number, wakeTs: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(bedTs) || !Number.isFinite(wakeTs)) return { ok: false, reason: 'non-finite timestamps' };
  if (wakeTs <= bedTs) return { ok: false, reason: 'wake must be after bed' };
  const hours = (wakeTs - bedTs) / 3600000;
  if (hours < 1) return { ok: false, reason: 'sleep shorter than 1h is not a night' };
  if (hours >= 48) return { ok: false, reason: 'sleep longer than 48h is not credible' };
  return { ok: true };
}

/**
 * Classify a night.
 * green: 420 ≤ duration ≤ 600 AND bed in [21:00–01:30] AND wake in [04:30–09:30] (all inclusive)
 * red:   duration < 420 (regardless of window)
 * yellow: everything else
 */
export function classifySleep(input: SleepInput): { color: SleepColor; durationMin: number; reasons: string[] } {
  const v = isValidSleepInput(input.bedTs, input.wakeTs);
  if (!v.ok) throw new Error(v.reason);

  const durationMin = durationMinutes(input.bedTs, input.wakeTs);
  const reasons: string[] = [];

  if (bedInWindow(input.bedMinutesOfDay) && wakeInWindow(input.wakeMinutesOfDay) &&
      durationMin >= GREEN_MIN_DURATION && durationMin <= GREEN_MAX_DURATION) {
    return { color: 'green', durationMin, reasons: [] };
  }

  if (durationMin < GREEN_MIN_DURATION) {
    reasons.push('short');
    return { color: 'red', durationMin, reasons };
  }

  // yellow, with the specific cause for debugging (not shown to the user as a verdict)
  if (durationMin > GREEN_MAX_DURATION) reasons.push('long');
  if (!bedInWindow(input.bedMinutesOfDay)) reasons.push('bed-late');
  if (!wakeInWindow(input.wakeMinutesOfDay)) reasons.push('wake-off-window');
  if (reasons.length === 0) reasons.push('off-window');
  return { color: 'yellow', durationMin, reasons };
}
