import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { z } from 'zod';
import { calendar, e1rm, normalize, sleep } from '@chudlog/shared';
import type { AppCtx, Variables } from './app.js';
import type { SQLiteDb } from './db.js';
import { appendLogEvent, settleUserFrom, todayWib } from './settle.js';
import { badRequest, conflict, notFound } from './errors.js';

export const TZ = calendar.PRIVATE_TZ;
export type ApiEnv = { Variables: Variables };
export const keySchema = z.string().min(8).max(80).optional();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === value;
}, 'invalid date');
export function readDate(c: Context<ApiEnv>, now = Date.now()) {
  const date = dateSchema.parse(c.req.query('date') ?? todayWib(now));
  if (date > todayWib(now)) throw badRequest('future dates are not allowed');
  if (date < '2020-01-01') throw badRequest('date is outside supported history');
  return date;
}
export interface Change {
  data: unknown;
  date: string;
  entityType: string;
  entityId: string;
  action?: 'create' | 'update' | 'delete' | 'rest-replace' | 'import' | 'restore';
}

/** Validated source mutation, audit event, projection, and replay receipt commit together. */
export async function command<T>(ctx: AppCtx, c: Context<ApiEnv>, schema: z.ZodType<T>, change: (id: string, input: T, now: number) => Change) {
  const raw = await c.req.json().catch(() => { throw badRequest('invalid JSON'); });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'invalid payload');
  const input = parsed.data;
  const key = keySchema.parse(c.req.header('Idempotency-Key') ?? (input as Record<string, unknown>).idempotency_key);
  const id = c.get('User')!.id;
  const now = Date.now();
  const fingerprint = createHash('sha256').update(JSON.stringify([c.req.method,c.req.path,input])).digest('hex');
  const result = ctx.db.db.transaction(() => {
    if (key) {
      const receipt = ctx.db.db.prepare('SELECT fingerprint,response FROM mutation_receipts WHERE user_id=? AND key=?').get(id,key) as {fingerprint:string;response:string} | undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw conflict('idempotency key already used for a different request');
        return JSON.parse(receipt.response) as unknown;
      }
    }
    const changed = change(id,input,now);
    if (changed.action) appendLogEvent(ctx.db.db,{userId:id,entityType:changed.entityType,entityId:changed.entityId,action:changed.action,date:changed.date,occurredAt:now,...(key ? {idempotencyKey:key} : {})});
    if (changed.action) settleUserFrom(ctx.db.db,id,changed.date,now);
    if (key) ctx.db.db.prepare('INSERT INTO mutation_receipts (user_id,key,fingerprint,response,created_at) VALUES (?,?,?,?,?)').run(id,key,fingerprint,JSON.stringify(changed.data),now);
    return changed.data;
  }).immediate();
  return c.newResponse(JSON.stringify(result),200,{'Content-Type':'application/json; charset=utf-8'});
}

export interface MealRow { id: string; name: string; amount: string; kcal: number; protein_g: number; carbs_g: number | null; fat_g: number | null; source_food_id: string | null; submitted_at: number }
export interface Meal { id:string;date:string;label:string|null;ts:number;submitted_at:number;rows:MealRow[] }
export function foodDay(db: SQLiteDb, id: string, date: string) {
  const meals = db.prepare('SELECT id,date,label,ts,submitted_at FROM meals WHERE user_id=? AND date=? ORDER BY ts,id').all(id,date) as Meal[];
  for (const meal of meals) meal.rows = db.prepare('SELECT id,name,amount,kcal,protein_g,carbs_g,fat_g,source_food_id,submitted_at FROM meal_rows WHERE meal_id=? ORDER BY rowid').all(meal.id) as MealRow[];
  return { date, meals, totals: meals.flatMap(meal=>meal.rows).reduce((total,row)=>({kcal:total.kcal+row.kcal,protein_g:total.protein_g+row.protein_g,carbs_g:total.carbs_g+(row.carbs_g??0),fat_g:total.fat_g+(row.fat_g??0)}),{kcal:0,protein_g:0,carbs_g:0,fat_g:0}) };
}
export function ownMeal(db: SQLiteDb, user: string, mealId: string) {
  const row = db.prepare('SELECT id,date FROM meals WHERE id=? AND user_id=?').get(mealId,user) as {id:string;date:string}|undefined;
  if (!row) throw notFound('meal not found');
  return row;
}
export interface RowInput { name:string;amount:string;kcal:number;protein_g:number;carbs_g?:number|undefined;fat_g?:number|undefined;micros?:Record<string,unknown>|undefined;source_food_id?:string|undefined }
export function insertFoodRow(db: SQLiteDb, user: string, mealId: string, row: RowInput, now: number, submittedAt = now) {
  if (row.source_food_id && !db.prepare('SELECT 1 FROM foods WHERE id=? AND user_id=?').get(row.source_food_id,user)) throw notFound('saved food not found');
  const norm = normalize.normName(row.name);
  if (!norm) throw badRequest('food name needs letters or numbers');
  db.prepare(`INSERT INTO meal_rows (id,meal_id,name,norm_name,amount,kcal,protein_g,carbs_g,fat_g,micros,source_food_id,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(),mealId,row.name,norm,row.amount,row.kcal,row.protein_g,row.carbs_g??null,row.fat_g??null,row.micros?JSON.stringify(row.micros):null,row.source_food_id??null,submittedAt);
}
export function sleepScore(bed: number, wake: number, now: number) {
  const valid = sleep.isValidSleepInput(bed,wake);
  if (!valid.ok) throw badRequest(valid.reason);
  if (wake > now || bed > now) throw badRequest('sleep timestamps cannot be in the future');
  if (wake < Date.parse('2020-01-01')) throw badRequest('sleep is outside supported history');
  return sleep.classifySleep({bedTs:bed,wakeTs:wake,bedMinutesOfDay:calendar.zonedInstant(bed,TZ).minutesOfDay,wakeMinutesOfDay:calendar.zonedInstant(wake,TZ).minutesOfDay});
}
export interface SetInput { kg:number|null;reps:number;rir?:string|undefined;warmup?:boolean|undefined }
export interface ExerciseInput { exercise:string;muscle:string;sets:SetInput[] }
export function saveWorkout(db: SQLiteDb, user: string, date: string, now: number, input: {started_ts:number;exercises:ExerciseInput[];duration_min?:number|undefined;notes?:string|undefined}, imported = false) {
  if (input.started_ts > now) throw badRequest('workout cannot start in the future');
  if (!input.exercises.some(block=>block.sets.some(set=>!set.warmup))) throw badRequest('a completed workout needs at least one working set');
  const old = db.prepare('SELECT id,kind,submitted_at,qualified_at FROM workouts WHERE user_id=? AND date=?').get(user,date) as {id:string;kind:string;submitted_at:number;qualified_at:number|null}|undefined;
  if (imported && old) throw conflict('this date already has a gym outcome');
  const id = old?.id ?? randomUUID();
  const qualifiedAt = old?.kind === 'workout' ? (old.qualified_at ?? old.submitted_at) : now;
  db.prepare(`INSERT INTO workouts (id,user_id,date,submitted_at,started_ts,kind,duration_min,notes,qualified_at) VALUES (?,?,?,?,?,'workout',?,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET kind='workout',started_ts=excluded.started_ts,rest_reason=NULL,duration_min=excluded.duration_min,notes=excluded.notes,qualified_at=excluded.qualified_at`)
    .run(id,user,date,old?.submitted_at??now,input.started_ts,input.duration_min??null,input.notes??null,qualifiedAt);
  db.prepare('DELETE FROM exercise_sets WHERE workout_id=?').run(id);
  const insert = db.prepare('INSERT INTO exercise_sets (id,workout_id,exercise,muscle,set_no,kg,reps,rir,e1rm,is_working) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const block of input.exercises) block.sets.forEach((set,index)=>insert.run(randomUUID(),id,block.exercise,block.muscle,index+1,set.kg,set.reps,set.rir??null,set.reps<=50?e1rm.epley(set.kg,set.reps):null,Number(!set.warmup)));
  return {id,action:old?.kind==='rest'?'rest-replace' as const:old?'update' as const:'create' as const};
}
