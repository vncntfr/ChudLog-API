// Pure TDEE + goal math (master record, locked).
// Mifflin-St Jeor BMR × activity factor, then the exact goal menu.
// Below-BMR result = warning line, NEVER blocked (owner decision).

export type Sex = 'm' | 'f';
export type GoalMode = 'maintain' | 'mild' | 'loss' | 'extreme' | 'custom';

export const ACTIVITY_FACTORS = [1.2, 1.375, 1.55, 1.725, 1.9] as const;

export function bmrMifflin(sex: Sex, kg: number, cm: number, age: number): number {
  if (kg <= 0 || kg > 400 || cm <= 0 || cm > 280 || age <= 0 || age > 130) {
    throw new Error('implausible body dimensions');
  }
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return sex === 'm' ? base + 5 : base - 161;
}

export function tdee(bmr: number, activityFactor: number): number {
  if (!ACTIVITY_FACTORS.includes(activityFactor as (typeof ACTIVITY_FACTORS)[number])) {
    throw new Error(`activity factor must be one of ${ACTIVITY_FACTORS.join(', ')}`);
  }
  return bmr * activityFactor;
}

/** Goal menu (locked): maintain 0 · mild −250 · loss −500 · extreme −1000 · custom n. */
export function goal(tdd: number, mode: GoalMode, custom?: number): number {
  switch (mode) {
    case 'maintain': return Math.round(tdd);
    case 'mild': return Math.round(tdd - 250);
    case 'loss': return Math.round(tdd - 500);
    case 'extreme': return Math.round(tdd - 1000);
    case 'custom':
      if (custom === undefined || !Number.isFinite(custom) || custom < 0) {
        throw new Error('custom goal must be a non-negative number');
      }
      return Math.round(custom);
  }
}

export function belowBmrWarning(bmr: number, target: number): string | null {
  if (target < bmr) {
    return `This goal is below your estimated resting energy need (~${Math.round(bmr)} kcal). It is allowed — ChudLog warns, it does not block.`;
  }
  return null;
}
