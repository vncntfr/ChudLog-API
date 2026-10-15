import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { calendar, normalize } from '@chudlog/shared';
import type { AppCtx } from '../app.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { appendMealRowSchema, createMealSchema, mealRowSchema, replaceMealRowsSchema, restSchema, savedFoodSchema, sleepSchema, workoutSchema } from '../schemas.js';
import { command, dateSchema, foodDay, insertFoodRow, keySchema, ownMeal, readDate, saveWorkout, sleepScore, TZ, type ApiEnv, type RowInput } from '../activity.js';
import { todayWib } from '../settle.js';

interface Food {id:string;name:string;norm_name:string;default_amount:string;kcal:number;protein_g:number;carbs_g:number|null;fat_g:number|null}
export function buildLogRoutes(ctx: AppCtx) {
  const app = new Hono<ApiEnv>();
  const db = ctx.db.db;
  app.get('/sleep', c => c.json({entries:db.prepare('SELECT id,date,bed_ts,wake_ts,duration_min,color,submitted_at FROM sleep WHERE user_id=? ORDER BY date DESC LIMIT 365').all(c.get('User')!.id)}));
  app.post('/sleep', c => command(ctx,c,sleepSchema.extend({idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const score = sleepScore(input.bed_ts,input.wake_ts,now);
    const date = calendar.calendarDate(input.wake_ts,TZ);
    const old = db.prepare('SELECT id FROM sleep WHERE user_id=? AND date=?').get(user,date) as {id:string}|undefined;
    const id = old?.id??randomUUID();
    db.prepare(`INSERT INTO sleep (id,user_id,date,submitted_at,bed_ts,wake_ts,duration_min,color) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,date) DO UPDATE SET bed_ts=excluded.bed_ts,wake_ts=excluded.wake_ts,duration_min=excluded.duration_min,color=excluded.color`)
      .run(id,user,date,now,input.bed_ts,input.wake_ts,score.durationMin,score.color);
    return {data:{id,date,...score},date,entityType:'sleep',entityId:id,action:old?'update':'create'};
  }));
  app.delete('/sleep/:id', c => command(ctx,c,z.object({idempotency_key:keySchema}).strict(),(user,_input)=>{
    const row = db.prepare('SELECT id,date FROM sleep WHERE id=? AND user_id=?').get(c.req.param('id'),user) as {id:string;date:string}|undefined;
    if (!row) throw notFound('sleep entry not found');
    db.prepare('DELETE FROM sleep WHERE id=?').run(row.id);
    return {data:{ok:true},date:row.date,entityType:'sleep',entityId:row.id,action:'delete'};
  }));
  app.get('/food/day', c => c.json(foodDay(db,c.get('User')!.id,readDate(c))));
  // Atomic meal+rows is the foreground/offline queue's preferred operation.
  app.post('/food/entries', c => command(ctx,c,z.object({label:z.string().trim().max(30).optional(),rows:z.array(mealRowSchema).min(1).max(100),date:dateSchema.optional(),idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const id = randomUUID(), date = input.date??todayWib(now);
    if(date>todayWib(now)||date<'2020-01-01')throw badRequest('invalid logging date');
    db.prepare('INSERT INTO meals (id,user_id,date,submitted_at,ts,label) VALUES (?,?,?,?,?,?)').run(id,user,date,now,now,input.label??null);
    for (const row of input.rows) insertFoodRow(db,user,id,row,now);
    return {data:{id,...foodDay(db,user,date)},date,entityType:'meal',entityId:id,action:'create'};
  }));
  app.post('/food/meals', c => command(ctx,c,createMealSchema.strict(),(user,input,now)=>{
    const id=randomUUID(),date=todayWib(now);
    db.prepare('INSERT INTO meals (id,user_id,date,submitted_at,ts,label) VALUES (?,?,?,?,?,?)').run(id,user,date,now,now,input.label??null);
    return {data:{id,date},date,entityType:'meal',entityId:id,action:'create'};
  }));
  app.put('/food/meals/:id', c => command(ctx,c,replaceMealRowsSchema.strict(),(user,input,now)=>{
    const meal=ownMeal(db,user,c.req.param('id'));
    if(input.label!==undefined)db.prepare('UPDATE meals SET label=? WHERE id=?').run(input.label,meal.id);
    // Preserve existing row submission times by position; a new row has its own server time.
    const previous=db.prepare('SELECT submitted_at FROM meal_rows WHERE meal_id=? ORDER BY rowid').all(meal.id) as {submitted_at:number|null}[];
    db.prepare('DELETE FROM meal_rows WHERE meal_id=?').run(meal.id);
    input.rows.forEach((row,index)=>insertFoodRow(db,user,meal.id,row,now,previous[index]?.submitted_at??now));
    return {data:foodDay(db,user,meal.date),date:meal.date,entityType:'meal',entityId:meal.id,action:'update'};
  }));
  app.post('/food/meals/:id/rows', c => command(ctx,c,appendMealRowSchema.strict(),(user,input,now)=>{
    const meal=ownMeal(db,user,c.req.param('id'));
    insertFoodRow(db,user,meal.id,input.row,now);
    return {data:foodDay(db,user,meal.date),date:meal.date,entityType:'meal',entityId:meal.id,action:'update'};
  }));
  app.delete('/food/meals/:id', c => command(ctx,c,z.object({idempotency_key:keySchema}).strict(),(user)=>{
    const meal=ownMeal(db,user,c.req.param('id'));
    db.prepare('DELETE FROM meals WHERE id=?').run(meal.id);
    return {data:{ok:true},date:meal.date,entityType:'meal',entityId:meal.id,action:'delete'};
  }));
  function foods(user:string) {return db.prepare('SELECT id,name,norm_name,default_amount,kcal,protein_g,carbs_g,fat_g FROM foods WHERE user_id=? ORDER BY name').all(user) as Food[];}
  app.get('/foods',c=>c.json({foods:foods(c.get('User')!.id)}));
  app.post('/food/search',async c=>{
    const input=z.object({q:z.string().trim().min(1).max(80)}).strict().parse(await c.req.json());
    const name=normalize.normName(input.q);
    return c.json({foods:foods(c.get('User')!.id).filter(food=>food.norm_name.startsWith(name)||normalize.suggestMerge(food.name,input.q).suggest).slice(0,20)});
  });
  app.post('/foods/save',c=>command(ctx,c,savedFoodSchema.extend({confirm_new:z.boolean().optional(),idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const norm=normalize.normName(input.name);
    if(!norm) throw badRequest('food name needs letters or numbers');
    const library=foods(user),exact=library.find(food=>food.norm_name===norm);
    if(exact) return {data:{food:exact,matched:true},date:todayWib(now),entityType:'food',entityId:exact.id};
    const suggestions=library.filter(food=>normalize.suggestMerge(food.name,input.name).suggest);
    if(suggestions.length&&!input.confirm_new) return {data:{suggestions},date:todayWib(now),entityType:'food',entityId:''};
    const id=randomUUID();
    db.prepare('INSERT INTO foods (id,user_id,name,norm_name,default_amount,kcal,protein_g,carbs_g,fat_g,micros,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,user,input.name,norm,input.default_amount,input.kcal,input.protein_g,input.carbs_g??null,input.fat_g??null,input.micros?JSON.stringify(input.micros):null,now);
    return {data:{food:foods(user).find(food=>food.id===id)},date:todayWib(now),entityType:'food',entityId:id,action:'create'};
  }));
  app.post('/foods/copy',c=>command(ctx,c,z.object({id:z.string().uuid(),idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const food=foods(user).find(food=>food.id===input.id);
    if(!food) throw notFound('saved food not found');
    return {data:{food},date:todayWib(now),entityType:'food',entityId:food.id};
  }));
  app.delete('/foods/:id',c=>command(ctx,c,z.object({idempotency_key:keySchema}).strict(),(user,_input,now)=>{
    const result=db.prepare('DELETE FROM foods WHERE id=? AND user_id=?').run(c.req.param('id'),user);
    if(!result.changes) throw notFound('saved food not found');
    return {data:{ok:true},date:todayWib(now),entityType:'food',entityId:c.req.param('id'),action:'delete'};
  }));
  function workout(user:string,date:string) {
    const row=db.prepare('SELECT id,date,kind,rest_reason,started_ts,duration_min,notes FROM workouts WHERE user_id=? AND date=?').get(user,date) as {id:string}|undefined;
    return row ? {...row,sets:db.prepare('SELECT id,exercise,muscle,set_no,kg,reps,rir,e1rm,is_working FROM exercise_sets WHERE workout_id=? ORDER BY rowid').all(row.id)} : null;
  }
  app.get('/gym/today',c=>c.json({date:readDate(c),workout:workout(c.get('User')!.id,readDate(c))}));
  app.get('/gym/history',c=>{
    const user=c.get('User')!.id;
    const dates=db.prepare('SELECT date FROM workouts WHERE user_id=? ORDER BY date DESC LIMIT 365').all(user) as {date:string}[];
    return c.json({workouts:dates.map(row=>workout(user,row.date))});
  });
  const workoutInput=workoutSchema.extend({date:dateSchema.optional()}).strict();
  app.post('/gym/workouts',c=>command(ctx,c,workoutInput,(user,input,now)=>{
    const date=input.date??todayWib(now);
    if(date>todayWib(now)||date<'2020-01-01')throw badRequest('invalid logging date');
    if(input.started_ts<calendar.localMidnight(date,TZ)-12*3600000||input.started_ts>=calendar.dayDeadline(date,TZ)) throw badRequest('workout start must be within its logging day or the preceding 12 hours');
    const result=saveWorkout(db,user,date,now,input);
    return {data:{id:result.id,date,workout:workout(user,date)},date,entityType:'workout',entityId:result.id,action:result.action};
  }));
  app.post('/gym/workouts/:id',c=>command(ctx,c,workoutInput,(user,input,now)=>{
    const row=db.prepare('SELECT id,date FROM workouts WHERE id=? AND user_id=?').get(c.req.param('id'),user) as {id:string;date:string}|undefined;
    if(!row) throw notFound('workout not found');
    if(!calendar.instantInLocalDay(input.started_ts,row.date,TZ)) throw badRequest('start must remain within the workout date');
    const result=saveWorkout(db,user,row.date,now,input);
    return {data:{id:row.id,workout:workout(user,row.date)},date:row.date,entityType:'workout',entityId:row.id,action:result.action};
  }));
  app.post('/gym/rest',c=>command(ctx,c,restSchema.extend({date:dateSchema.optional()}).strict(),(user,input,now)=>{
    const date=input.date??todayWib(now);
    if(date>todayWib(now)||date<'2020-01-01')throw badRequest('invalid logging date');
    const old=db.prepare('SELECT id,kind FROM workouts WHERE user_id=? AND date=?').get(user,date) as {id:string;kind:string}|undefined;
    if(old?.kind==='workout') throw conflict('a completed workout cannot be overwritten with REST; delete it first if it was a mistake');
    const id=old?.id??randomUUID();
    db.prepare(`INSERT INTO workouts (id,user_id,date,submitted_at,started_ts,kind,rest_reason) VALUES (?,?,?,?,?,'rest',?) ON CONFLICT(user_id,date) DO UPDATE SET rest_reason=excluded.rest_reason`).run(id,user,date,now,now,input.reason??null);
    return {data:{id,date,kind:'rest'},date,entityType:'workout',entityId:id,action:old?'update':'create'};
  }));
  app.delete('/gym/workouts/:id',c=>command(ctx,c,z.object({idempotency_key:keySchema}).strict(),(user)=>{
    const row=db.prepare('SELECT id,date FROM workouts WHERE id=? AND user_id=?').get(c.req.param('id'),user) as {id:string;date:string}|undefined;
    if(!row) throw notFound('workout not found');
    db.prepare('DELETE FROM workouts WHERE id=?').run(row.id);
    return {data:{ok:true},date:row.date,entityType:'workout',entityId:row.id,action:'delete'};
  }));
  return app;
}
