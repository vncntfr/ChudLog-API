// Pure season math (master record: 3-month cycles Jan 1 / Apr 1 / Jul 1 /
// Oct 1 of the zone calendar; 50% carryover, VISIBLE derank; lifetime untouched).

/** 'YYYY-MM-DD' → 'YYYY-Qn' (Q1=Jan..Mar, Q2=Apr..Jun, Q3=Jul..Sep, Q4=Oct..Dec). */
export function seasonId(date: string): string {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  const q = Math.floor((mo - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

export function isSeasonStart(date: string): boolean {
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return d === 1 && (mo === 1 || mo === 4 || mo === 7 || mo === 10);
}

/**
 * Carryover into a new season: floor(prevSeasonPoints / 2).
 * The tier is RECOMPUTED from the carried-over value (a Gold can literally
 * drop to Silver — visibility is the point). Lifetime points/rank untouched.
 */
export function seasonCarryover(prevSeasonPoints: number): number {
  if (!Number.isInteger(prevSeasonPoints) || prevSeasonPoints < 0) {
    throw new Error('season points must be a non-negative integer');
  }
  return Math.floor(prevSeasonPoints / 2);
}
