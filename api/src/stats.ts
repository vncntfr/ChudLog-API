import type { SQLiteDb } from './db.js';
import { calendar } from '@chudlog/shared';
import { todayWib } from './settle.js';

export interface WorkingSet {date:string;exercise:string;muscle:string;kg:number|null;reps:number;rir:string|null;e1rm:number|null;duration_min:number|null;is_working:number}
export function gymStats(db:SQLiteDb,user:string,from:string,to=todayWib()) {
  const sets=db.prepare(`SELECT w.date,s.exercise,s.muscle,s.kg,s.reps,s.rir,s.e1rm,w.duration_min,s.is_working FROM workouts w JOIN exercise_sets s ON s.workout_id=w.id WHERE w.user_id=? AND w.date BETWEEN ? AND ? AND w.kind='workout' ORDER BY w.date,s.rowid`).all(user,from,to) as WorkingSet[];
  const working=sets.filter(set=>set.is_working);
  const heatmap:Record<string,{date:string;volume:number;sets:number;duration_min:number}>={};
  const muscles:Record<string,number>={},weeklyMuscles:Record<string,Record<string,number>>={},weeklyVolume:Record<string,number>={},effort:Record<string,number>={'0':0,'1':0,'2':0,'3+':0,'unlogged':0};
  const exercises:Record<string,Array<{date:string;e1rm:number}>>={},bests:Record<string,{exercise:string;e1rm:number;date:string}>={},prs:Array<{exercise:string;e1rm:number;date:string}>=[];
  let push=0,pull=0,legs=0;
  for(const set of working) {
    const volume=(set.kg??0)*set.reps;
    heatmap[set.date]??={date:set.date,volume:0,sets:0,duration_min:set.duration_min??0};
    heatmap[set.date]!.volume+=volume;heatmap[set.date]!.sets++;
    muscles[set.muscle]=(muscles[set.muscle]??0)+1;
    const week=calendar.calendarDate(calendar.weekStartInstant(calendar.localMidnight(set.date,'Asia/Jakarta'),'Asia/Jakarta'),'Asia/Jakarta');
    weeklyMuscles[week]??={};weeklyMuscles[week]![set.muscle]=(weeklyMuscles[week]![set.muscle]??0)+1;
    weeklyVolume[week]=(weeklyVolume[week]??0)+volume;
    effort[set.rir??'unlogged']=(effort[set.rir??'unlogged']??0)+1;
    if(/chest|shoulder|tricep|push/i.test(set.muscle))push++;
    else if(/back|bicep|pull/i.test(set.muscle))pull++;
    else if(/leg|quad|hamstring|glute|calf|calves/i.test(set.muscle))legs++;
    if(set.e1rm!==null && set.kg!==null && set.reps<=12) {
      exercises[set.exercise]??=[];
      const previous=exercises[set.exercise]!.find(point=>point.date===set.date);
      if(previous)previous.e1rm=Math.max(previous.e1rm,set.e1rm);else exercises[set.exercise]!.push({date:set.date,e1rm:set.e1rm});
      if(!bests[set.exercise]||set.e1rm>bests[set.exercise]!.e1rm) {
        const pr={exercise:set.exercise,e1rm:set.e1rm,date:set.date};bests[set.exercise]=pr;prs.push(pr);
      }
    }
  }
  return {from,to,workouts:Object.keys(heatmap).length,total_volume:working.reduce((n,set)=>n+(set.kg??0)*set.reps,0),total_sets:working.length,
    heatmap:Object.values(heatmap),muscles:Object.entries(muscles).map(([label,value])=>({label,value})),weekly_muscles:weeklyMuscles,
    weekly_volume:Object.entries(weeklyVolume).map(([label,value])=>({label,value})),effort:Object.entries(effort).map(([label,value])=>({label,value})),
    structural:[{label:'Push',value:push},{label:'Pull',value:pull},{label:'Legs',value:legs}],e1rm:exercises,prs:prs.reverse(),top_prs:Object.values(bests).sort((a,b)=>b.e1rm-a.e1rm).slice(0,5),
    notes:['Volume counts external load on working sets; bodyweight-only sets contribute no invented kilograms.','e1RM trends use sets of 1–12 reps. Muscle and push/pull counts depend on the logged muscle; left/right balance needs explicitly sided exercises.']};
}
export function memberSummary(db:SQLiteDb,user:string,now=Date.now()) {
  const date=todayWib(now),from=calendar.shiftLocalDate(date,-89,'Asia/Jakarta');
  const activity=db.prepare(`SELECT COUNT(*) AS lit_days FROM day_log WHERE user_id=? AND lit=1`).get(user) as {lit_days:number};
  const registered=db.prepare('SELECT created_at FROM users WHERE id=?').get(user) as {created_at:number};
  const first=calendar.calendarDate(registered.created_at,'Asia/Jakarta');
  const denominator=Math.min(90,Math.max(1,Math.round((calendar.localMidnight(date,'Asia/Jakarta')-calendar.localMidnight(first,'Asia/Jakarta'))/86400000)+1));
  const consistency=db.prepare('SELECT COUNT(*) AS n FROM day_log WHERE user_id=? AND date BETWEEN ? AND ? AND lit=1').get(user,from,date) as {n:number};
  const nights=db.prepare('SELECT duration_min,color,bed_ts FROM sleep WHERE user_id=? AND date>=? AND date<=?').all(user,calendar.shiftLocalDate(date,-29,'Asia/Jakarta'),date) as {duration_min:number;color:string;bed_ts:number}[];
  // Circular mean avoids averaging 23:00 and 01:00 to noon.
  const angles=nights.map(n=>calendar.zonedInstant(n.bed_ts,'Asia/Jakarta').minutesOfDay/1440*2*Math.PI);
  const mean=angles.length?(Math.atan2(angles.reduce((s,a)=>s+Math.sin(a),0),angles.reduce((s,a)=>s+Math.cos(a),0))+2*Math.PI)%(2*Math.PI):null;
  return {lit_days:activity.lit_days,consistency_90:Math.round(consistency.n/denominator*100),consistency_days:denominator,
    sleep_30:{nights:nights.length,average_duration_min:nights.length?Math.round(nights.reduce((n,row)=>n+row.duration_min,0)/nights.length):null,green_percent:nights.length?Math.round(nights.filter(n=>n.color==='green').length/nights.length*100):null,average_bed_min:mean===null?null:Math.round(mean/Math.PI/2*1440)%1440},
    gym:gymStats(db,user,'2020-01-01',date)};
}
