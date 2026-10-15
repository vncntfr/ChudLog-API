// Pure Chud Points + rank ladder (master record, 2026-10-13 revision — WORKOUT ONLY).
//
// Rules (locked, revised):
// - Chud Points are earned ONLY on a qualifying, actually logged workout day:
//   kind='workout' with at least one valid completed working set.
// - REST, food-only, sleep-only days earn 0. (REST still satisfies the gym
//   log → still makes the day lit → still feeds the streak/flame.)
// - Base is 10. The streak multiplier (1×/2×/3×/5×) applies ONLY when that
//   workout day is a REAL LIT day (food+sleep+gym all logged by deadline).
// - A real workout on a day whose other trackers are missing earns the BASE
//   10 (not 0): the person trained, the accountabilities that were missed
//   are already visible in the streak state.
// - At most ONE award per local calendar date — no backfill farming: a
//   workout logged after its day's midnight is a record in history, not an
//   on-time award.
// - Multiplier uses the ACCOUNTABILITY streak the workout day participates
//   in (streakAfter = streak length including today if lit).
//
// The old "calendar-day points" projection (perfect year ≈ 17k) is INVALID
// after this revision — thresholds will be re-simulated from pilot data.
// The tier ladder itself is UNCHANGED (pending that recalibration).

export const POINTS_BASE = 10;

export type StreakBucket = 'base' | 'tier1' | 'tier2' | 'tier3';

/**
 * Daily point value for a qualifying workout:
 *   10            — workout day, other trackers incomplete (streak 0 or day not lit)
 *   10 / 20 / 30 / 50 — workout day that is a real lit day, streak (days) in
 *                       buckets: 1–6 → 10 (1×); 7–13 → 20 (2×); 14–29 → 30 (3×); 30+ → 50 (5×)
 */
export function pointsForWorkoutDay(opts: {
  hasQualifyingWorkout: boolean;
  dayIsLit: boolean;
  streakAfter: number; // streak length including this day (0 if day is not lit)
  alreadyEarnedToday: boolean;
}): number {
  if (!opts.hasQualifyingWorkout) return 0;
  if (opts.alreadyEarnedToday) return 0; // idempotence: one award per day
  if (!opts.dayIsLit) return POINTS_BASE;

  const s = Math.max(0, opts.streakAfter);
  if (s <= 0) return POINTS_BASE;
  if (s <= 6) return POINTS_BASE * 1;
  if (s <= 13) return POINTS_BASE * 2;
  if (s <= 29) return POINTS_BASE * 3;
  return POINTS_BASE * 5;
}

/**
 * Rank tiers (unchanged by the revision — thresholds pending post-pilot
 * recalibration). Lifetime points, never demoted within a season (private).
 */
export const RANK_LADDER: ReadonlyArray<{ tier: string; min: number; label: string }> = [
  { tier: 'iron', min: 0, label: 'Iron' },
  { tier: 'bronze', min: 300, label: 'Bronze' },
  { tier: 'silver', min: 800, label: 'Silver' },
  { tier: 'gold', min: 1500, label: 'Gold' },
  { tier: 'platinum', min: 2500, label: 'Platinum' },
  { tier: 'emerald', min: 4000, label: 'Emerald' },
  { tier: 'diamond', min: 6000, label: 'Diamond' },
  { tier: 'master', min: 9000, label: 'Master' },
  { tier: 'challenger', min: 13000, label: 'Challenger' },
];

export function tierFor(lifetimePoints: number): string {
  let out = RANK_LADDER[0]!;
  for (const step of RANK_LADDER) {
    if (lifetimePoints >= step.min) out = step;
    else break;
  }
  return out.tier;
}

/** 0-based index into the 9 SVG rank hexes. */
export function tierIndex(tier: string): number {
  const i = RANK_LADDER.findIndex((r) => r.tier === tier);
  return i < 0 ? 0 : i;
}

/** Points to the next tier (0 when maxed). For the hex progress arc. */
export function pointsToNextTier(lifetimePoints: number): number {
  for (const step of RANK_LADDER) {
    if (lifetimePoints < step.min) return step.min - lifetimePoints;
  }
  return 0;
}

/** Streak multiplier display (used by the nameplate, matches pointsForWorkoutDay buckets). */
export function streakMultiplier(streak: number): 1 | 2 | 3 | 5 {
  if (streak <= 6) return 1;
  if (streak <= 13) return 2;
  if (streak <= 29) return 3;
  return 5;
}
