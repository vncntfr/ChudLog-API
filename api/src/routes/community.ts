import { Hono } from 'hono';
import { z } from 'zod';
import { calendar } from '@chudlog/shared';
import type { AppCtx } from '../app.js';
import type { ApiEnv } from '../activity.js';
import { command, dateSchema, keySchema } from '../activity.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { settleUserFrom, todayWib } from '../settle.js';
import { gymStats, memberSummary } from '../stats.js';

export function buildCommunityRoutes(ctx:AppCtx) {
  const app=new Hono<ApiEnv>(),db=ctx.db.db;
  function commonGroup(owner:string,member:string) {
    if(!db.prepare('SELECT 1 FROM group_members a JOIN group_members b ON a.group_id=b.group_id WHERE a.user_id=? AND b.user_id=?').get(owner,member)) throw notFound('member not found');
  }
  function board(group:string,from:string,to:string) {
    return db.prepare(`SELECT u.id,u.display_name,COALESCE(SUM(d.points_earned),0) AS points,
      COALESCE(SUM(CASE WHEN d.points_earned>0 THEN 1 ELSE 0 END),0) AS workout_days,COALESCE(SUM(d.lit),0) AS lit_days
      FROM group_members m JOIN users u ON u.id=m.user_id LEFT JOIN day_log d ON d.user_id=u.id AND d.date BETWEEN ? AND ?
      WHERE m.group_id=? GROUP BY u.id ORDER BY points DESC,workout_days DESC,lit_days DESC,u.id`).all(from,to,group);
  }
  function groupFor(user:string) {
    const group=db.prepare('SELECT g.id,g.name FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=?').get(user) as {id:string;name:string}|undefined;
    if(!group)throw notFound('group not found');return group;
  }
  function member(id:string,now:number) {
    settleUserFrom(db,id,todayWib(now),now);
    const user=db.prepare('SELECT id,display_name,created_at,calorie_goal,protein_goal FROM users WHERE id=?').get(id);
    return {user,rank_state:db.prepare('SELECT current_streak,longest_streak,longest_streak_date,lifetime_points,lifetime_tier,season_points,season_tier,last_activity_ts FROM rank_state WHERE user_id=?').get(id),today:db.prepare('SELECT food,sleep,gym,lit,points_earned FROM day_log WHERE user_id=? AND date=?').get(id,todayWib(now))};
  }
  app.get('/group',c=>{
    const group=groupFor(c.get('User')!.id),now=Date.now();
    const ids=db.prepare('SELECT user_id FROM group_members WHERE group_id=? ORDER BY joined_at,user_id').all(group.id) as {user_id:string}[];
    return c.json({group,members:ids.map(row=>member(row.user_id,now))});
  });
  app.get('/group/leaderboard',c=>{
    const group=groupFor(c.get('User')!.id),now=Date.now(),date=todayWib(now);
    const ids=db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(group.id) as {user_id:string}[];
    for(const row of ids)settleUserFrom(db,row.user_id,date,now);
    const start=calendar.calendarDate(calendar.weekStartInstant(now,'Asia/Jakarta'),'Asia/Jakarta');
    const previous=board(group.id,calendar.shiftLocalDate(start,-7,'Asia/Jakarta'),calendar.shiftLocalDate(start,-1,'Asia/Jakarta')) as {id:string;points:number}[];
    return c.json({week_start:start,week:board(group.id,start,date),alltime:board(group.id,'2020-01-01',date),chud_of_week:previous[0]&&previous[0].points>0?previous[0].id:null});
  });
  app.get('/group/members/:id',c=>{
    const owner=c.get('User')!.id,id=c.req.param('id');commonGroup(owner,id);
    return c.json({...member(id,Date.now()),summary:memberSummary(db,id)});
  });
  app.get('/group/feed',c=>{
    const group=groupFor(c.get('User')!.id),date=todayWib();
    const sleeps=db.prepare('SELECT s.user_id,u.display_name,s.date,s.bed_ts,s.wake_ts,s.duration_min,s.color,s.submitted_at FROM sleep s JOIN users u ON u.id=s.user_id JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? AND s.date=?').all(group.id,date);
    const meals=db.prepare('SELECT m.user_id,u.display_name,m.id,m.label,m.ts,r.name,r.amount,r.kcal,r.protein_g FROM meals m JOIN users u ON u.id=m.user_id JOIN group_members g ON g.user_id=u.id JOIN meal_rows r ON r.meal_id=m.id WHERE g.group_id=? AND m.date=? ORDER BY m.ts DESC').all(group.id,date);
    const gym=db.prepare('SELECT w.user_id,u.display_name,w.id,w.kind,w.rest_reason,w.duration_min,w.submitted_at FROM workouts w JOIN users u ON u.id=w.user_id JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? AND w.date=?').all(group.id,date);
    return c.json({date,sleep:sleeps,food:meals,gym});
  });
  app.get('/gym/stats',c=>{
    const range=z.coerce.number().int().min(7).max(365).parse(c.req.query('range')??365),date=todayWib();
    return c.json(gymStats(db,c.get('User')!.id,calendar.shiftLocalDate(date,-range+1,'Asia/Jakarta'),date));
  });
  app.get('/me/summary',c=>c.json(memberSummary(db,c.get('User')!.id)));
  app.get('/today',c=>{
    const id=c.get('User')!.id,date=todayWib();settleUserFrom(db,id,date);
    return c.json({date,day:db.prepare('SELECT date,food,sleep,gym,lit,restore_used,points_earned FROM day_log WHERE user_id=? AND date=?').get(id,date),nudges:db.prepare('SELECT local_hour,due_trackers,status,attempts FROM nudge_log WHERE user_id=? AND local_date=? ORDER BY local_hour').all(id,date),restore:restoreOffer(id,date)});
  });
  function restoreOffer(id:string,date:string) {
    const missed=calendar.shiftLocalDate(date,-1,'Asia/Jakarta'),before=calendar.shiftLocalDate(date,-2,'Asia/Jakarta');
    const days=db.prepare('SELECT date,lit FROM day_log WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date').all(id,before,date) as {date:string;lit:number}[];
    const used=db.prepare('SELECT used_ts FROM restores WHERE user_id=?').all(id) as {used_ts:number}[];
    const month=calendar.monthKey(date);
    return days.length===3&&days[0]!.lit===1&&days[1]!.lit===0&&days[2]!.lit===1&&!used.some(row=>calendar.monthKey(todayWib(row.used_ts))===month)?{date:missed,month}:null;
  }
  app.post('/streak/restore',c=>command(ctx,c,z.object({date:dateSchema,idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const date=todayWib(now);settleUserFrom(db,user,date,now);
    const offer=restoreOffer(user,date);
    if(!offer||offer.date!==input.date)throw conflict('restore requires exactly one missed day before today, a complete day today, and an unused monthly restore');
    db.prepare('INSERT INTO restores (user_id,date,used_ts) VALUES (?,?,?)').run(user,input.date,now);
    return {data:{ok:true,date:input.date},date:input.date,entityType:'streak',entityId:input.date,action:'restore'};
  }));
  return app;
}
