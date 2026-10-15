// Pure protein goal (owner decision): 1.5 g × profile bodyweight, rounded to whole grams.
//
// Privacy note (master record): a group-visible protein goal REVEALS an
// approximate raw bodyweight (goal / 1.5). Private members consent at
// onboarding; public adds an explicit inference disclosure.
export const PROTEIN_G_PER_KG = 1.5;

export function proteinGoal(bodyweightKg: number): number {
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0 || bodyweightKg >= 400) {
    throw new Error('implausible bodyweight');
  }
  return Math.round(PROTEIN_G_PER_KG * bodyweightKg);
}
