import { expect,test } from 'vitest';
import { ladder,flame,normalize } from '../src/lib/index.js';
test('50 estimated movement tables are monotonic and use a pinned version',()=>{
  expect(ladder.LADDER_EXERCISES).toHaveLength(50);
  for(const movement of ladder.LADDER_EXERCISES) {
    let previous=0;
    for(let weight=0;weight<=500;weight+=5){const score=ladder.scoreStrength(movement.exercise,weight,80,'m')!;expect(score.score).toBeGreaterThanOrEqual(previous);previous=score.score;expect(score.standard_version).toBe(ladder.STANDARD_VERSION);}
  }
  expect(ladder.scoreStrength('Barbell bench press',40,80,'m')?.score).toBe(1);
  expect(ladder.scoreStrength('Unknown movement',100,80,'m')).toBeNull();
});
test('flame thresholds match all seven original tiers',()=>{
  const days=[0,2,3,6,7,29,30,89,90,179,180,364,365,1000];
  expect(days.map(day=>flame.flameTier(day).key)).toEqual(['ash','ash','spark','spark','ember','ember','blaze','blaze','inferno','inferno','hellfire','hellfire','eternal','eternal']);
});
test('food normalization preserves international scripts',()=>{
  expect(normalize.normName('  РИС! ')).toBe('рис');expect(normalize.normName('أرز، دجاج')).toBe('أرز دجاج');
});
