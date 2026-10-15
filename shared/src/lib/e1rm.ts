// Pure e1RM + Ladder A scaffolding (master record; Ladder A table is an
// open build-time item — compiled + cited at build time, estimates marked as
// estimates with the standard version pinned).

/**
 * Epley estimated 1-rep max: e1rm = kg × (1 + reps/30), rounded to 2 dp.
 * Guards: reps must be ≥ 1 finite integer; kg ≥ 0 finite.
 * A 1-rep effort IS a measured 1RM — return the weight itself, no estimate
 * (Epley on reps=1 would inflate it by 3.3%).
 * Bodyweight-only moves (kg null) are NOT scored by formula — Ladder A uses
 * per-exercise BW% anchors (table, open item 3). Returns null for bodyweight
 * rows, not a fake number.
 */
export function epley(kg: number | null, reps: number): number | null {
  if (kg === null) return null; // bodyweight row → table-based Ladder A
  if (!Number.isInteger(reps) || reps < 1 || reps > 50) throw new Error('reps must be an integer 1..50');
  if (!Number.isFinite(kg) || kg < 0 || kg > 1000) throw new Error('implausible kg');
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 100) / 100;
}

export interface LadderScore {
  e1rmKgbw: number; // e1RM as % of bodyweight
  score: number; // 1..1000 (0 if below scale floor)
  rank: number; // 0..8 on the 9-rank ladder
  rankLabel: string;
  estimated: boolean; // always true until the compiled table is cited as standard
}

/**
 * Score a set on the 1–1000 scale from a bodyweight-% anchor table.
 * table: exercise → { bwPct: number; score: number }[] sorted ascending,
 *        monotonic. Linear interpolation between anchors; clamp at the ends.
 * The ~50 compound lifts + anchors are the open build item #3; this function
 * is the contract the table must satisfy.
 */
export function ladderScore(opts: {
  exercise: string;
  e1rm: number;
  bodyweightKg: number;
  table: Record<string, Array<{ bwPct: number; score: number }>>;
  standardVersion: string;
}): LadderScore {
  const { exercise, e1rm, bodyweightKg, table, standardVersion } = opts;
  if (bodyweightKg <= 0 || bodyweightKg >= 400) throw new Error('implausible bodyweight');
  const e1rmKgbw = (e1rm / bodyweightKg) * 100;
  const anchors = table[exercise];
  if (!anchors || anchors.length === 0) {
    throw new Error(`no Ladder A anchors for '${exercise}' (standard ${standardVersion})`);
  }
  // Floor rule: anchors may start with a 0-score sentinel (the scale floor).
  // Below the first anchor that actually scores, nothing scores.
  const firstScored = anchors.find((a) => a.score > 0);
  if (firstScored && e1rmKgbw < firstScored.bwPct) {
    return fin(e1rmKgbw, 0, e1rmKgbw);
  }
  if (e1rmKgbw < anchors[0]!.bwPct) {
    return fin(e1rmKgbw, 0, e1rmKgbw);
  }
  const last = anchors[anchors.length - 1]!;
  if (e1rmKgbw >= last.bwPct) {
    return fin(e1rmKgbw, last.score, e1rmKgbw);
  }
  let lo = anchors[0]!;
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i]!.bwPct >= e1rmKgbw) {
      const hi = anchors[i]!;
      const f = (e1rmKgbw - lo.bwPct) / (hi.bwPct - lo.bwPct || 1);
      return fin(e1rmKgbw, lo.score + f * (hi.score - lo.score), e1rmKgbw);
    }
    lo = anchors[i]!;
  }
  return fin(e1rmKgbw, last.score, e1rmKgbw);

  function fin(kgbw: number, score: number, _raw: number): LadderScore {
    const s = Math.max(0, Math.min(1000, Math.round(score)));
    const rank = Math.min(8, Math.floor(s / 100));
    return { e1rmKgbw: Math.round(kgbw * 10) / 10, score: s, rank, rankLabel: RANK_LABELS[rank]!, estimated: true };
  }
}

const RANK_LABELS = ['Wood', 'Stone', 'Bronze', 'Iron', 'Steel', 'Titan', 'Mythic', 'Legendary', 'Olympian'] as const;
