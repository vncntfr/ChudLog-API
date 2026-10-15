import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { calendar, ladder } from '@chudlog/shared';
import { exerciseBlockSchema } from '../schemas.js';
import { command, keySchema, type ApiEnv } from '../activity.js';
import type { AppCtx } from '../app.js';
import { badRequest, notFound } from '../errors.js';
import { todayWib } from '../settle.js';
import { exercises } from '../data/exercises.js';

const routineSchema=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(80),kind:z.enum(['weekday','rotation']),weekday:z.number().int().min(1).max(7).optional(),sequence:z.number().int().min(0).max(100).optional(),exercises:z.array(exerciseBlockSchema).min(1).max(30),idempotency_key:keySchema}).strict();
export function buildRoutineRoutes(ctx:AppCtx) {
  const app=new Hono<ApiEnv>(),db=ctx.db.db;
  function list(user:string) {
    const rows=db.prepare('SELECT id,name,kind,weekday,sequence,exercises FROM routines WHERE user_id=? ORDER BY kind,sequence,weekday,id').all(user) as {id:string;name:string;kind:string;weekday:number|null;sequence:number|null;exercises:string}[];
    return rows.map(row=>({...row,exercises:JSON.parse(row.exercises) as unknown}));
  }
  app.get('/gym/exercises',c=>c.json({exercises}));
  app.get('/gym/ladder',c=>{
    const user=c.get('User')!.id;
    const profile=db.prepare('SELECT sex,bodyweight_kg FROM users WHERE id=?').get(user) as {sex:'m'|'f'|null;bodyweight_kg:number|null};
    const bests=db.prepare(`SELECT s.exercise,MAX(s.e1rm) AS e1rm FROM exercise_sets s JOIN workouts w ON w.id=s.workout_id WHERE w.user_id=? AND w.kind='workout' AND s.is_working=1 AND s.reps BETWEEN 1 AND 12 GROUP BY s.exercise`).all(user) as {exercise:string;e1rm:number|null}[];
    const results=profile.sex&&profile.bodyweight_kg?bests.flatMap(row=>{if(row.e1rm===null)return [];const score=ladder.scoreStrength(row.exercise,row.e1rm,profile.bodyweight_kg!,profile.sex!);return score?[score]:[];}):[];
    return c.json({standard_version:ladder.STANDARD_VERSION,exercises:ladder.LADDER_EXERCISES,results,profile_ready:Boolean(profile.sex&&profile.bodyweight_kg),caveat:'Estimated game benchmarks, not validated population percentiles. Variation multipliers and machine comparisons are provisional. Uses current self-only profile weight/sex and best logged e1RM from working sets of 1–12 reps. Dumbbell rows marked per-hand require load per hand. Bodyweight-only moves are unscored.'});
  });
  app.get('/gym/routines',c=>{
    const user=c.get('User')!.id,routines=list(user),clock=calendar.zonedInstant(Date.now(),'Asia/Jakarta');
    const rotations=routines.filter(row=>row.kind==='rotation');
    const completed=(db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id=? AND kind='workout'").get(user) as {n:number}).n;
    return c.json({routines,suggested:routines.find(row=>row.kind==='weekday'&&row.weekday===clock.isoWeekday)??rotations[completed%Math.max(1,rotations.length)]??null});
  });
  app.post('/gym/routines',c=>command(ctx,c,routineSchema,(user,input,now)=>{
    if(input.kind==='weekday'&&input.weekday===undefined)throw badRequest('weekday routine requires a weekday');
    if(input.id&&!db.prepare('SELECT id FROM routines WHERE user_id=? AND id=?').get(user,input.id))throw notFound('routine not found');
    const id=input.id??randomUUID();
    db.prepare(`INSERT INTO routines (id,user_id,name,kind,weekday,sequence,exercises) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,weekday=excluded.weekday,sequence=excluded.sequence,exercises=excluded.exercises`).run(id,user,input.name,input.kind,input.kind==='weekday'?input.weekday:null,input.kind==='rotation'?input.sequence??0:null,JSON.stringify(input.exercises));
    return {data:{routines:list(user)},date:todayWib(now),entityType:'routine',entityId:id,action:input.id?'update':'create'};
  }));
  app.delete('/gym/routines/:id',c=>command(ctx,c,z.object({idempotency_key:keySchema}).strict(),(user,_input,now)=>{
    const result=db.prepare('DELETE FROM routines WHERE id=? AND user_id=?').run(c.req.param('id'),user);
    if(!result.changes)throw notFound('routine not found');
    return {data:{ok:true},date:todayWib(now),entityType:'routine',entityId:c.req.param('id'),action:'delete'};
  }));
  return app;
}
