import { Hono } from 'hono';
import type { AppCtx, Variables } from '../app.js';
import { profileUpdateSchema } from '../schemas.js';
import { protein, tdee } from '@chudlog/shared';
import { settleUserFrom, todayWib } from '../settle.js';
import { badRequest } from '../errors.js';

const fields = 'id,email,display_name,tz,created_at,sex,age,height_cm,bodyweight_kg,activity_factor,bar_weight_kg,plates_kg,calorie_goal,calorie_goal_mode,protein_goal';
type Profile = { id: string; sex: 'm' | 'f' | null; age: number | null; height_cm: number | null; bodyweight_kg: number | null; activity_factor: number; calorie_goal: number | null; calorie_goal_mode: tdee.GoalMode | null; plates_kg: string | null };
export function buildMeRoutes({ db }: AppCtx) {
  const app = new Hono<{ Variables: Variables }>();
  function read(id: string) {
    settleUserFrom(db.db, id, todayWib());
    const user = db.db.prepare(`SELECT ${fields} FROM users WHERE id = ?`).get(id) as Profile;
    return {
      user: { ...user, plates_kg: user.plates_kg ? JSON.parse(user.plates_kg) : [] },
      rank_state: db.db.prepare('SELECT current_streak,longest_streak,longest_streak_date,lifetime_points,lifetime_tier,season_id,season_points,season_tier FROM rank_state WHERE user_id = ?').get(id),
      today: db.db.prepare('SELECT date,food,sleep,gym,lit,points_earned FROM day_log WHERE user_id = ? AND date = ?').get(id, todayWib()) ?? { date: todayWib(), food: 0, sleep: 0, gym: 0, lit: 0, points_earned: 0 },
      settings: db.db.prepare('SELECT morning_push FROM user_settings WHERE user_id = ?').get(id),
      group: db.db.prepare('SELECT g.id,g.name,g.invite_code FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ?').get(id),
    };
  }
  app.get('/me', c => c.json(read(c.get('User')!.id)));
  app.put('/me', async c => {
    const parsed = profileUpdateSchema.strict().safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid payload' }, 400);
    const id = c.get('User')!.id;
    let warning: string | null = null;
    db.db.transaction(() => {
      const old = db.db.prepare(`SELECT ${fields} FROM users WHERE id = ?`).get(id) as Profile;
      const patch: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.activity_factor !== undefined) patch.activity_factor = Number(parsed.data.activity_factor);
      if (parsed.data.plates_kg !== undefined) patch.plates_kg = JSON.stringify(parsed.data.plates_kg);
      if (parsed.data.bodyweight_kg !== undefined) patch.protein_goal = parsed.data.bodyweight_kg === null ? null : protein.proteinGoal(parsed.data.bodyweight_kg);
      const next = { ...old, ...patch } as Profile;
      if (next.calorie_goal_mode === 'custom') {
        if (next.calorie_goal === null) throw badRequest('custom mode requires calorie_goal');
      } else if (next.calorie_goal_mode) {
        if (next.sex && next.age && next.height_cm && next.bodyweight_kg) {
          const bmr = tdee.bmrMifflin(next.sex, next.bodyweight_kg, next.height_cm, next.age);
          patch.calorie_goal = tdee.goal(tdee.tdee(bmr, next.activity_factor), next.calorie_goal_mode);
          warning = tdee.belowBmrWarning(bmr, patch.calorie_goal as number);
        } else patch.calorie_goal = null;
      }
      if (next.calorie_goal_mode === 'custom' && next.sex && next.age && next.height_cm && next.bodyweight_kg) {
        warning = tdee.belowBmrWarning(tdee.bmrMifflin(next.sex, next.bodyweight_kg, next.height_cm, next.age), next.calorie_goal!);
      }
      const keys = Object.keys(patch);
      if (keys.length) db.db.prepare(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`).run(...keys.map(k => patch[k]), id);
    })();
    return c.json({ ...read(id), warning });
  });
  return app;
}
