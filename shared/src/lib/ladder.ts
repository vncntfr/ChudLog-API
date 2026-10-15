import { ladderScore } from './e1rm.js';
export const STANDARD_VERSION='chudlog-estimated-bw-2026-10-15-v1';
// The five broad reference ratios are read from Strength Level's own community tables.
// Mapping those levels to scores, and ALL variation multipliers, are ChudLog estimates.
const families={
  bench:{m:[.5,1,1.25,1.5,2],f:[.3,.5,.75,1.1,1.45],source:'https://strengthlevel.com/strength-standards/bench-press'},
  squat:{m:[.75,1.25,1.75,2.25,2.75],f:[.5,.75,1.25,1.75,2.25],source:'https://strengthlevel.com/strength-standards/squat'},
  deadlift:{m:[1,1.5,2,2.5,3.25],f:[.75,1,1.5,2,2.5],source:'https://strengthlevel.com/strength-standards/deadlift'},
  press:{m:[.35,.55,.8,1.05,1.35],f:[.2,.35,.5,.7,.95],source:'https://strengthlevel.com/strength-standards/shoulder-press'},
} as const;
const variations:Array<[string,keyof typeof families,number,'total'|'per-hand']>=[
  ['Barbell back squat','squat',1,'total'],['Front squat','squat',.8,'total'],['Pause squat','squat',.9,'total'],['Box squat','squat',1,'total'],['Goblet squat','squat',.35,'total'],['Bulgarian split squat','squat',.2,'per-hand'],['Leg press','squat',1.8,'total'],['Hack squat','squat',1.2,'total'],['Walking lunge','squat',.2,'per-hand'],['Reverse lunge','squat',.2,'per-hand'],
  ['Conventional deadlift','deadlift',1,'total'],['Sumo deadlift','deadlift',1,'total'],['Romanian deadlift','deadlift',.8,'total'],['Trap bar deadlift','deadlift',1.05,'total'],['Stiff leg deadlift','deadlift',.75,'total'],['Good morning','deadlift',.4,'total'],['Hip thrust','deadlift',1.1,'total'],['Glute bridge','deadlift',.9,'total'],['Cable pull through','deadlift',.35,'total'],['Single leg Romanian deadlift','deadlift',.2,'per-hand'],
  ['Barbell bench press','bench',1,'total'],['Incline barbell bench press','bench',.85,'total'],['Decline barbell bench press','bench',1.05,'total'],['Close grip bench press','bench',.85,'total'],['Paused bench press','bench',.95,'total'],['Dumbbell bench press','bench',.4,'per-hand'],['Incline dumbbell press','bench',.35,'per-hand'],['Chest press','bench',1,'total'],
  ['Overhead press','press',1,'total'],['Seated overhead press','press',1,'total'],['Dumbbell shoulder press','press',.4,'per-hand'],['Arnold press','press',.35,'per-hand'],['Push press','press',1.2,'total'],['Landmine press','press',.65,'total'],
  ['Barbell row','bench',.9,'total'],['Pendlay row','bench',.85,'total'],['Dumbbell row','bench',.45,'per-hand'],['Seated cable row','bench',.9,'total'],['T bar row','bench',.8,'total'],['Chest supported row','bench',.35,'per-hand'],['Lat pulldown','bench',.9,'total'],['Wide grip pulldown','bench',.85,'total'],['Neutral grip pulldown','bench',.9,'total'],['Single arm cable row','bench',.4,'per-hand'],['Dumbbell gorilla row','bench',.4,'per-hand'],['Machine row','bench',1,'total'],['Seal row','bench',.75,'total'],['Meadows row','bench',.4,'total'],['Underhand barbell row','bench',.9,'total'],['Close grip cable row','bench',.9,'total'],
];
export const LADDER_EXERCISES=variations.map(([exercise,family,multiplier,load])=>({exercise,family,multiplier,load,source:families[family].source,estimated:true as const}));
export function scoreStrength(exercise:string,maxKg:number,bodyweightKg:number,sex:'m'|'f') {
  const variation=LADDER_EXERCISES.find(row=>row.exercise.toLowerCase()===exercise.trim().toLowerCase());
  if(!variation)return null;
  const ratios=families[variation.family][sex],scores=[1,250,500,750,1000];
  const anchors=ratios.map((ratio,index)=>({bwPct:ratio*variation.multiplier*100,score:scores[index]!}));
  return {...ladderScore({exercise:variation.exercise,e1rm:maxKg,bodyweightKg,table:{[variation.exercise]:anchors},standardVersion:STANDARD_VERSION}),exercise:variation.exercise,standard_version:STANDARD_VERSION,source:variation.source,load:variation.load};
}
