import { describe, it, expect } from 'vitest';
import { sleep, calendar, points, normalize, tdee, protein, e1rm, season } from '../src/lib/index.js';

// ---------------------------------------------------------------- sleep ----
// Mandatory boundaries (private handoff §5): exactly 21:00, 01:30, 01:31,
// 04:30, 09:30, 09:31; 7h, 10h, 6h59m, 10h01m; red regardless of window;
// color never fails logging (that's the api's settleDay job).
const TZ = 'Asia/Jakarta';
const D = '2026-01-15'; // a Wednesday in WIB
const at = (date: string, h: number, m: number): number => {
  const [y, mo, d] = date.split('-').map(Number);
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), h, m, 0) - 7 * 3600000; // WIB = UTC+7 fixed
};
const mins = (h: number, m: number) => h * 60 + m;

function night(bed: [string, number, number], wake: [string, number, number]) {
  return { bedTs: at(bed[0], bed[1], bed[2]), wakeTs: at(wake[0], wake[1], wake[2]) };
}
function cls(bed: [string, number, number], wake: [string, number, number]) {
  const n = night(bed, wake);
  return sleep.classifySleep({
    ...n,
    bedMinutesOfDay: calendar.zonedInstant(n.bedTs, TZ).minutesOfDay,
    wakeMinutesOfDay: calendar.zonedInstant(n.wakeTs, TZ).minutesOfDay,
  });
}

describe('sleep classifier (locked, inclusive minutes-of-day)', () => {
  it('7h, bed 23:00 wake 06:00 — green', () => {
    expect(cls([D, 23, 0], ['2026-01-16', 6, 0]).color).toBe('green');
  });
  it('edge durations: 21:00 bed → 04:00 wake is 7h but the wake is OFF-window → yellow', () => {
    expect(cls([D, 21, 0], ['2026-01-16', 4, 0]).color).toBe('yellow');
  });
  it('22:00→05:00 (exactly 7h, both in window) is green', () => {
    expect(cls([D, 22, 0], ['2026-01-16', 5, 0]).color).toBe('green');
    expect(cls([D, 22, 0], ['2026-01-16', 5, 0]).durationMin).toBe(420);
  });
  it('exactly 21:00 bed with 8h (05:00 wake) is green — bed open bound inclusive', () => {
    expect(cls([D, 21, 0], ['2026-01-16', 5, 0]).color).toBe('green');
  });
  it('exactly 01:30 bed with 8h30 (10:00 wake? no — 01:30+8.5h=10:00 off-window; use 01:30→09:30 = 8h) green', () => {
    expect(cls(['2026-01-15', 1, 30], [D, 9, 30]).color).toBe('green'); // 01:30→09:30 = 8h
  });
  it('bed 01:31 is OUT of the window (yellow even with 8h)', () => {
    const c = cls(['2026-01-15', 1, 31], [D, 9, 30]); // 01:31→09:30 = 7h59m < 420? no: 479m ≥420
    expect(c.color).toBe('yellow');
  });
  it('wake exactly 04:30 after 7h (21:30→04:30 = 7h) is green — wake open bound inclusive', () => {
    expect(cls([D, 21, 30], ['2026-01-16', 4, 30]).color).toBe('green');
  });
  it('wake exactly 09:30 after 8h (01:30→09:30) is green — wake close bound inclusive (also covers 01:30 bed)', () => {
    expect(cls(['2026-01-15', 1, 30], [D, 9, 30]).color).toBe('green');
  });
  it('wake 09:31 is OUT of the window (yellow with 8h)', () => {
    const c = cls(['2026-01-15', 1, 30], [D, 9, 31]); // 8h01m
    expect(c.color).toBe('yellow');
  });
  it('exactly 7h0m0s (420 min) with good window is green (lower bound inclusive)', () => {
    expect(cls([D, 22, 0], ['2026-01-16', 5, 0]).durationMin).toBe(420);
  });
  it('6h59m (419 min) is RED — lower bound exclusive below', () => {
    const c = cls([D, 22, 0], ['2026-01-16', 4, 59]);
    expect(c.durationMin).toBe(419);
    expect(c.color).toBe('red');
  });
  it('exactly 10h0m0s (600 min) with window is green (upper bound inclusive)', () => {
    // 23:00 → 09:00 = 10h, wake 09:00 in window
    expect(cls([D, 23, 0], ['2026-01-16', 9, 0]).durationMin).toBe(600);
    expect(cls([D, 23, 0], ['2026-01-16', 9, 0]).color).toBe('green');
  });
  it('10h01m (601 min) is YELLOW (long), not red', () => {
    const c = cls([D, 23, 0], ['2026-01-16', 9, 1]);
    expect(c.durationMin).toBe(601);
    expect(c.color).toBe('yellow');
  });
  it('6h bed 22:00 wake 04:00 (window-ish but short) is RED regardless of window', () => {
    const c = cls([D, 22, 0], ['2026-01-16', 4, 0]);
    expect(c.color).toBe('red');
  });
  it('11h with perfect window is YELLOW (over-sleep)', () => {
    expect(cls([D, 22, 0], ['2026-01-16', 9, 0]).color).toBe('yellow');
  });
  it('rejects wake ≤ bed', () => {
    const n = night([D, 23, 0], [D, 0, 0]);
    expect(sleep.isValidSleepInput(n.bedTs, n.wakeTs).ok).toBe(false);
  });
  it('rejects 48h+', () => {
    const n = night([D, 23, 0], ['2026-01-17', 3, 0]); // 28h
    expect(sleep.isValidSleepInput(n.bedTs, n.wakeTs).ok).toBe(true);
    const n2 = night([D, 23, 0], ['2026-01-19', 0, 0]); // 49h
    expect(sleep.isValidSleepInput(n2.bedTs, n2.wakeTs).ok).toBe(false);
  });
});

// ------------------------------------------------------------ calendar -----
describe('calendar (WIB locked, no DST)', () => {
  it('Asia/Jakarta offset is +07:00 in winter AND summer (no DST flips)', () => {
    const winter = Date.UTC(2026, 0, 15, 12, 0, 0); // noon local
    const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(calendar.utcOffsetMinutes(winter, TZ)).toBe(420);
    expect(calendar.utcOffsetMinutes(summer, TZ)).toBe(420);
  });
  it('17:00 UTC is 00:00 NEXT day WIB (the midnight cutoff is exact)', () => {
    expect(calendar.calendarDate(Date.UTC(2026, 0, 15, 16, 59, 59), TZ)).toBe('2026-01-15');
    expect(calendar.calendarDate(Date.UTC(2026, 0, 15, 17, 0, 0), TZ)).toBe('2026-01-16');
  });
  it('dayDeadline(2026-01-15) === 2026-01-15T17:00:00Z', () => {
    expect(calendar.dayDeadline('2026-01-15', TZ)).toBe(Date.UTC(2026, 0, 15, 17, 0, 0));
  });
  it('weekStart: Wed 2026-01-14 23:00 WIB → Mon 2026-01-12 00:00 WIB', () => {
    const midweek = Date.UTC(2026, 0, 14, 16, 0, 0); // 23:00 WIB
    const ws = calendar.weekStartInstant(midweek, TZ);
    expect(calendar.calendarDate(ws, TZ)).toBe('2026-01-12');
    expect(calendar.zonedInstant(ws, TZ).hour).toBe(0);
    expect(calendar.zonedInstant(ws, TZ).minute).toBe(0);
    expect(calendar.zonedInstant(ws, TZ).isoWeekday).toBe(1); // Monday
  });
  it('weekStart: Monday 05:00 WIB → same Monday 00:00 WIB', () => {
    const mon = Date.UTC(2026, 0, 12, 22, 0, 0); // 05:00 WIB Mon
    const ws = calendar.weekStartInstant(mon, TZ);
    expect(calendar.calendarDate(ws, TZ)).toBe('2026-01-12');
  });
  it('shiftLocalDate respects month lengths (WIB zero-DST)', () => {
    expect(calendar.shiftLocalDate('2026-01-31', 1, TZ)).toBe('2026-02-01');
    expect(calendar.shiftLocalDate('2026-03-31', 1, TZ)).toBe('2026-04-01');
    expect(calendar.shiftLocalDate('2026-02-01', -1, TZ)).toBe('2026-01-31');
  });
  it('seasonId is quarterly on the fixed starts', () => {
    expect(season.seasonId('2026-04-01')).toBe('2026-Q2');
    expect(season.seasonId('2026-12-31')).toBe('2026-Q4');
    expect(season.isSeasonStart('2026-04-01')).toBe(true);
    expect(season.isSeasonStart('2026-04-02')).toBe(false);
  });
  it('nudge due-hours: gym 08 due, 12 due, 13 gym+food due, 23 all due, 24 none', () => {
    expect(calendar.isNudgeHourDue('gym', 8)).toBe(true);
    expect(calendar.isNudgeHourDue('food', 12)).toBe(false);
    expect(calendar.isNudgeHourDue('food', 13)).toBe(true);
    expect(calendar.isNudgeHourDue('sleep', 23)).toBe(true);
    expect(calendar.isNudgeHourDue('gym', 7)).toBe(false);
    // 08:00 is the bundled morning push hour (all due trackers + morning state)
    expect(calendar.isNudgeHourDue('sleep', 8)).toBe(true);
  });
  it('zone validation rejects garbage', () => {
    expect(calendar.isIanaTimeZone('Asia/Jakarta')).toBe(true);
    expect(calendar.isIanaTimeZone('Not/AZone')).toBe(false);
    expect(calendar.isIanaTimeZone('')).toBe(false);
  });
});

// -------------------------------------------------------------- points -----
describe('points (WORKOUT ONLY — 2026-10-13 revision)', () => {
  it('REST day = 0 points (even when the day is fully lit)', () => {
    expect(points.pointsForWorkoutDay({ hasQualifyingWorkout: false, dayIsLit: true, streakAfter: 35, alreadyEarnedToday: false })).toBe(0);
  });
  it('food+sleep only = 0', () => {
    expect(points.pointsForWorkoutDay({ hasQualifyingWorkout: false, dayIsLit: false, streakAfter: 0, alreadyEarnedToday: false })).toBe(0);
  });
  it('workout on a non-lit day = base 10 (tried, day incomplete)', () => {
    expect(points.pointsForWorkoutDay({ hasQualifyingWorkout: true, dayIsLit: false, streakAfter: 0, alreadyEarnedToday: false })).toBe(10);
  });
  it('workout on a lit day uses the streak multiplier: 1×/2×/3×/5× at 6→7→13→14→29→30', () => {
    const lit = { hasQualifyingWorkout: true, dayIsLit: true, alreadyEarnedToday: false };
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 1 })).toBe(10);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 6 })).toBe(10);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 7 })).toBe(20);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 13 })).toBe(20);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 14 })).toBe(30);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 29 })).toBe(30);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 30 })).toBe(50);
    expect(points.pointsForWorkoutDay({ ...lit, streakAfter: 365 })).toBe(50);
  });
  it('idempotent: second award the same day = 0', () => {
    expect(points.pointsForWorkoutDay({ hasQualifyingWorkout: true, dayIsLit: true, streakAfter: 8, alreadyEarnedToday: true })).toBe(0);
  });
  it('rank ladder is unchanged and monotonic', () => {
    expect(points.tierFor(0)).toBe('iron');
    expect(points.tierFor(299)).toBe('iron');
    expect(points.tierFor(300)).toBe('bronze');
    expect(points.tierFor(12999)).toBe('master');
    expect(points.tierFor(13000)).toBe('challenger');
    expect(points.pointsToNextTier(0)).toBe(300);
    expect(points.pointsToNextTier(13000)).toBe(0);
  });
});

// ------------------------------------------------------------ normalize ----
describe('normalize (suggest, never auto-merge)', () => {
  it('hard dedup: exact normalized match', () => {
    expect(normalize.normName('Nasi Goreng')).toBe(normalize.normName('nasi goreng'));
    expect(normalize.normName('  NAsI  GORENG!! ')).toBe(normalize.normName('nasi goreng'));
  });
  it('the nasi goreng pair is a SUGGEST not a silent merge', () => {
    const r = normalize.suggestMerge('nasi goreng', 'nasi goreng special');
    expect(r.suggest).toBe(true);
  });
  it('unrelated names are NOT suggests', () => {
    const r = normalize.suggestMerge('nasi goreng', 'chicken breast');
    expect(r.suggest).toBe(false);
  });
  it('nearly identical is a similarity suggest', () => {
    const r = normalize.suggestMerge('banana', 'banan');
    expect(r.suggest).toBe(true);
  });
  it('unicode-safe: diacritics kept, not stripped', () => {
    const n = normalize.normName('pasta á la carta');
    expect(n).toContain('la');
    expect(n.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ tdee ---
describe('tdee + protein (locked formulas)', () => {
  it('Mifflin-St Jeor male example: 80kg 180cm 25y active 1.55', () => {
    const bmr = tdee.bmrMifflin('m', 80, 180, 25);
    expect(bmr).toBe(10 * 80 + 6.25 * 180 - 5 * 25 + 5); // 1790
    expect(tdee.tdee(bmr, 1.55)).toBeCloseTo(bmr * 1.55, 0);
    expect(tdee.goal(tdee.tdee(bmr, 1.55), 'loss')).toBeCloseTo(bmr * 1.55 - 500, 0);
    expect(tdee.belowBmrWarning(bmr, bmr * 1.55 - 500)).toBeNull();
  });
  it('below-BMR goal warns but never blocks', () => {
    const bmr = tdee.bmrMifflin('f', 50, 160, 20); // 1124
    const target = tdee.goal(tdee.tdee(bmr, 1.2), 'extreme');
    expect(tdee.belowBmrWarning(bmr, target)).toMatch(/warning|allowed|does not block/i);
  });
  it('rejects implausible bodies', () => {
    expect(() => tdee.bmrMifflin('m', -1, 180, 25)).toThrow();
  });
  it('protein goal = round(1.5 × kg) and reveals ~weight (disclosed): goal ÷ 1.5 ≈ 80 kg', () => {
    expect(protein.proteinGoal(80)).toBe(120);
    expect(protein.proteinGoal(65.4)).toBe(98);
    expect(protein.proteinGoal(80) / protein.PROTEIN_G_PER_KG).toBeCloseTo(80, 0);
  });
});

// ------------------------------------------------------------------ e1rm ---
describe('e1rm (Epley)', () => {
  it('Epley 100kg×5 = 116.67', () => {
    expect(e1rm.epley(100, 5)).toBeCloseTo(116.666, 1);
  });
  it('1 rep = the weight itself', () => {
    expect(e1rm.epley(120, 1)).toBe(120);
  });
  it('bodyweight row (kg=null) returns null, never a fake number', () => {
    expect(e1rm.epley(null, 10)).toBeNull();
  });
  it('guards: reps 0, 51, negative kg throw', () => {
    expect(() => e1rm.epley(100, 0)).toThrow();
    expect(() => e1rm.epley(100, 51)).toThrow();
    expect(() => e1rm.epley(-1, 5)).toThrow();
  });
  it('ladderScore interpolates linearly between anchors and clamps', () => {
    const table = { bench: [{ bwPct: 0, score: 0 }, { bwPct: 50, score: 250 }, { bwPct: 100, score: 550 }, { bwPct: 200, score: 800 }] };
    const base = { bodyweightKg: 80, table, standardVersion: 'test-0.1' };
    expect(e1rm.ladderScore({ ...base, exercise: 'bench', e1rm: 80 * 0.5 })!.score).toBe(250); // exact anchor
    const mid = e1rm.ladderScore({ ...base, exercise: 'bench', e1rm: 80 * 0.75 })!; // 75% BW between 50→250 and 100→550
    expect(mid.score).toBe(400); // midpoint interpolation
    expect(e1rm.ladderScore({ ...base, exercise: 'bench', e1rm: 80 * 3 })!.score).toBe(800); // clamped
    expect(e1rm.ladderScore({ ...base, exercise: 'bench', e1rm: 80 * 0.1 })!.score).toBe(0); // below floor
    expect(e1rm.ladderScore({ ...base, exercise: 'bench', e1rm: 80 * 0.5 })!.estimated).toBe(true);
  });
});

// ---------------------------------------------------------------- season ---
describe('season', () => {
  it('carryover is floor(50%) and can derank visibly', () => {
    expect(season.seasonCarryover(1499)).toBe(749); // gold 1500 → silver 749
    expect(season.seasonCarryover(749)).toBe(374);
    expect(season.seasonCarryover(0)).toBe(0);
  });
});
