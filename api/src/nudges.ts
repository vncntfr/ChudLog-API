import webpush from 'web-push';
import { calendar } from '@chudlog/shared';
import type { AppCtx } from './app.js';
import { settleUserFrom, todayWib } from './settle.js';

export type DueTracker='sleep'|'gym'|'food';
interface Day {sleep:number;gym:number;food:number}
interface Subscription {endpoint:string;p256dh:string;auth:string}
export type PushSender=(subscription:Subscription,payload:string)=>Promise<unknown>;
export function dueTrackers(day:Day|undefined,hour:number):DueTracker[] {
  return (['sleep','gym','food'] as const).filter(tracker=>calendar.isNudgeHourDue(tracker,hour)&&!day?.[tracker]);
}
export const NUDGE_LINES=[
  'Your day is open. Show up.', 'Start with one honest entry.',
  'A plan is not a log. Make it real.', 'The empty tiles are waiting.',
  'Your circle can see the gap.', 'No perfect day needed. Record the real one.',
  'Small session? Log it. REST day? Declare it.', 'Keep the standard you chose.',
  'One entry gets you moving.', 'The clock keeps going. So can you.',
  'Your next action is a log.', 'The group is showing up. Join them.',
  'Less negotiating. More recording.', 'An honest record beats an empty tile.',
  'Close the gap while today is yours.', 'Your future self wants the record.',
  'The final hours are here.', 'Make the remaining tiles count.',
  'Midnight WIB closes the day.', 'Last stretch. Finish the record.',
] as const;
export function nudgeCopy(hour:number,due:DueTracker[]) {
  if(!due.length)return {title:'ChudLog · Morning status',body:'All three logs are in. Keep the standard.'};
  const index=Math.max(0,Math.min(19,Math.floor((hour-8)*19/15)));
  return {title:hour>=20?'ChudLog · Final hours':'ChudLog · Show up',body:`Still unlogged: ${due.join(', ')}. ${NUDGE_LINES[index]}${hour>=20?' Deadline: midnight WIB.':''}`};
}
export function allowedPushEndpoint(raw:string) {
  try {
    const url=new URL(raw);
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443')&&
      (host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com'));
  }catch{return false;}
}
function dayFor(ctx:AppCtx,user:string,date:string) {return ctx.db.db.prepare('SELECT sleep,gym,food FROM day_log WHERE user_id=? AND date=?').get(user,date) as Day|undefined;}
export function createNudgeJobs(ctx:AppCtx,now=Date.now()) {
  const clock=calendar.zonedInstant(now,'Asia/Jakarta');
  if(clock.hour<8||clock.hour>23)return 0;
  const db=ctx.db.db;
  const users=db.prepare('SELECT u.id,s.morning_push FROM users u LEFT JOIN user_settings s ON s.user_id=u.id').all() as {id:string;morning_push:number|null}[];
  let created=0;
  for(const user of users) {
    settleUserFrom(db,user.id,clock.date,now);
    const due=dueTrackers(dayFor(ctx,user.id,clock.date),clock.hour);
    if(!due.length&&!(clock.hour===8&&user.morning_push))continue;
    db.transaction(()=>{
      const inserted=db.prepare(`INSERT OR IGNORE INTO nudge_log (user_id,local_date,local_hour,due_trackers,status,created_at,next_attempt_at) VALUES (?,?,?,?,'pending',?,?)`).run(user.id,clock.date,clock.hour,JSON.stringify(due),now,now);
      if(!inserted.changes)return;
      created++;
      const subscriptions=db.prepare('SELECT endpoint FROM push_subs WHERE user_id=?').all(user.id) as {endpoint:string}[];
      for(const sub of subscriptions)db.prepare(`INSERT OR IGNORE INTO nudge_deliveries (user_id,local_date,local_hour,endpoint,status,next_attempt_at) VALUES (?,?,?,?,'pending',?)`).run(user.id,clock.date,clock.hour,sub.endpoint,now);
      if(!subscriptions.length)db.prepare("UPDATE nudge_log SET status='dead',last_error='no subscription' WHERE user_id=? AND local_date=? AND local_hour=?").run(user.id,clock.date,clock.hour);
    }).immediate();
  }
  return created;
}
export async function dispatchNudges(ctx:AppCtx,now=Date.now(),send:PushSender=async(sub,payload)=>webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:900,timeout:10000})) {
  const db=ctx.db.db,clock=calendar.zonedInstant(now,'Asia/Jakarta');
  const jobs=db.prepare(`SELECT user_id,local_date,local_hour,due_trackers,created_at FROM nudge_log WHERE status IN ('pending','retry') AND COALESCE(next_attempt_at,0)<=? ORDER BY created_at LIMIT 100`).all(now) as {user_id:string;local_date:string;local_hour:number;due_trackers:string;created_at:number}[];
  for(const job of jobs) {
    settleUserFrom(db,job.user_id,clock.date,now);
    const original=JSON.parse(job.due_trackers) as DueTracker[],current=dueTrackers(dayFor(ctx,job.user_id,clock.date),clock.hour);
    const due=original.filter(tracker=>current.includes(tracker));
    const expired=clock.date!==job.local_date||clock.hour!==job.local_hour||now-job.created_at>15*60000||(original.length>0&&!due.length);
    if(expired) {
      db.prepare("UPDATE nudge_deliveries SET status='dead' WHERE user_id=? AND local_date=? AND local_hour=? AND status IN ('pending','retry')").run(job.user_id,job.local_date,job.local_hour);
      db.prepare("UPDATE nudge_log SET status='dead',last_error='expired or satisfied' WHERE user_id=? AND local_date=? AND local_hour=?").run(job.user_id,job.local_date,job.local_hour);continue;
    }
    const copy=nudgeCopy(job.local_hour,due),tag=`${job.user_id}:${job.local_date}:${job.local_hour}`;
    const payload=JSON.stringify({...copy,tag,icon:'/icon.svg',data:{deepLink:'/',userId:job.user_id}});
    const deliveries=db.prepare(`SELECT d.endpoint,d.attempts,s.p256dh,s.auth FROM nudge_deliveries d LEFT JOIN push_subs s ON s.endpoint=d.endpoint AND s.user_id=d.user_id WHERE d.user_id=? AND d.local_date=? AND d.local_hour=? AND d.status IN ('pending','retry') AND COALESCE(d.next_attempt_at,0)<=?`).all(job.user_id,job.local_date,job.local_hour,now) as (Subscription&{attempts:number})[];
    for(const sub of deliveries) {
      const keys=[job.user_id,job.local_date,job.local_hour,sub.endpoint];
      const claim=db.prepare(`UPDATE nudge_deliveries SET status='retry',next_attempt_at=?,attempts=attempts+1 WHERE user_id=? AND local_date=? AND local_hour=? AND endpoint=? AND status IN ('pending','retry') AND COALESCE(next_attempt_at,0)<=?`).run(now+60000,...keys,now);
      if(!claim.changes)continue;
      let state='accepted',retryAt:number|null=null;
      if(!sub.p256dh||!allowedPushEndpoint(sub.endpoint))state='dead';
      else try{await send(sub,payload);}catch(err){
        const status=(err as {statusCode?:number}).statusCode;
        if(status===404||status===410)db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(sub.endpoint,job.user_id);
        const transient=status===undefined||status===408||status===429||status>=500;
        state=transient&&sub.attempts+1<4?'retry':'dead';retryAt=state==='retry'?now+Math.min(120000,15000*2**sub.attempts):null;
      }
      db.prepare('UPDATE nudge_deliveries SET status=?,next_attempt_at=? WHERE user_id=? AND local_date=? AND local_hour=? AND endpoint=?').run(state,retryAt,...keys);
    }
    const states=db.prepare('SELECT status,next_attempt_at,attempts FROM nudge_deliveries WHERE user_id=? AND local_date=? AND local_hour=?').all(job.user_id,job.local_date,job.local_hour) as {status:string;next_attempt_at:number|null;attempts:number}[];
    const retry=states.filter(row=>row.status==='pending'||row.status==='retry');
    const state=retry.length?'retry':states.some(row=>row.status==='accepted')?'accepted':'dead';
    const next=retry.length?Math.min(...retry.map(row=>row.next_attempt_at??now+60000)):null;
    db.prepare('UPDATE nudge_log SET status=?,attempts=?,next_attempt_at=?,accepted_at=?,last_error=? WHERE user_id=? AND local_date=? AND local_hour=?').run(state,states.reduce((sum,row)=>sum+row.attempts,0),next,state==='accepted'?now:null,state==='dead'?'no accepted subscription':null,job.user_id,job.local_date,job.local_hour);
  }
}
export function startNudgeWorker(ctx:AppCtx) {
  if(!ctx.env.vapidPublicKey||!ctx.env.vapidPrivateKeyJwk)return ()=>{};
  webpush.setVapidDetails(ctx.env.vapidSub,ctx.env.vapidPublicKey,ctx.env.vapidPrivateKeyJwk);
  let running=false,lastHour='';
  const run=async()=>{
    if(running)return;running=true;
    try {
      const now=Date.now(),hour=new Date(now).toISOString().slice(0,13);
      if(lastHour!==hour){createNudgeJobs(ctx,now);lastHour=hour;}
      await dispatchNudges(ctx,now);
    }catch{console.error('nudge worker failed; retrying on next tick');}
    finally{running=false;}
  };
  void run();const timer=setInterval(()=>void run(),15000);timer.unref();
  return ()=>clearInterval(timer);
}
