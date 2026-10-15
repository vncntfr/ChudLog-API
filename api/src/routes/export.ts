import { Hono } from 'hono';
import type { AppCtx } from '../app.js';
import type { ApiEnv } from '../activity.js';
export function buildExportRoutes(ctx:AppCtx) {
  const app=new Hono<ApiEnv>(),db=ctx.db.db;
  app.get('/me/export',c=>{
    const user=c.get('User')!.id;
    const result=db.transaction(()=>({
      schema_version:1,calendar_tz:'Asia/Jakarta',exported_at:new Date().toISOString(),
      profile:db.prepare('SELECT id,email,display_name,tz,created_at,sex,age,height_cm,bodyweight_kg,activity_factor,bar_weight_kg,plates_kg,calorie_goal,calorie_goal_mode,protein_goal FROM users WHERE id=?').get(user),
      sleep:db.prepare('SELECT id,date,calendar_tz,submitted_at,bed_ts,wake_ts,duration_min,color FROM sleep WHERE user_id=? ORDER BY date').all(user),
      meals:db.prepare('SELECT id,date,calendar_tz,submitted_at,ts,label FROM meals WHERE user_id=? ORDER BY date,ts').all(user),
      meal_rows:db.prepare('SELECT r.id,r.meal_id,r.name,r.norm_name,r.amount,r.kcal,r.protein_g,r.carbs_g,r.fat_g,r.micros,r.source_food_id,r.submitted_at FROM meal_rows r JOIN meals m ON m.id=r.meal_id WHERE m.user_id=? ORDER BY m.date,r.rowid').all(user),
      foods:db.prepare('SELECT id,name,norm_name,default_amount,kcal,protein_g,carbs_g,fat_g,micros,created_at FROM foods WHERE user_id=?').all(user),
      workouts:db.prepare('SELECT id,date,calendar_tz,submitted_at,qualified_at,started_ts,kind,rest_reason,duration_min,notes FROM workouts WHERE user_id=? ORDER BY date').all(user),
      sets:db.prepare('SELECT s.id,s.workout_id,s.exercise,s.muscle,s.set_no,s.kg,s.reps,s.rir,s.e1rm,s.is_working FROM exercise_sets s JOIN workouts w ON w.id=s.workout_id WHERE w.user_id=? ORDER BY w.date,s.rowid').all(user),
      routines:db.prepare('SELECT id,name,kind,weekday,sequence,exercises FROM routines WHERE user_id=?').all(user),
      day_log:db.prepare('SELECT date,calendar_tz,food,sleep,gym,lit,restore_used,points_earned FROM day_log WHERE user_id=? ORDER BY date').all(user),
      restores:db.prepare('SELECT date,used_ts FROM restores WHERE user_id=? ORDER BY date').all(user),
      audit:db.prepare('SELECT id,entity_type,entity_id,action,occurred_at,date,idempotency_key FROM log_events WHERE user_id=? ORDER BY occurred_at').all(user),
      settings:db.prepare('SELECT morning_push FROM user_settings WHERE user_id=?').get(user),
      imports:db.prepare('SELECT id,source,status,created_at,confirmed_at FROM import_jobs WHERE user_id=?').all(user),
    }))();
    c.header('Content-Disposition','attachment; filename="chudlog-export-v1.json"');return c.json(result);
  });
  return app;
}
