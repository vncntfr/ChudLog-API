import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppCtx } from '../app.js';
import { command, keySchema, saveWorkout, type ApiEnv } from '../activity.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { previewCsv, type ImportReport } from '../import-csv.js';
import { settleUserFrom, todayWib } from '../settle.js';
export function buildImportRoutes(ctx:AppCtx) {
  const app=new Hono<ApiEnv>(),db=ctx.db.db;
  app.post('/gym/import/:source',async c=>{
    const source=z.enum(['hevy','strong']).parse(c.req.param('source')),user=c.get('User')!.id;
    const text=await c.req.text();
    const fingerprint=createHash('sha256').update(text).digest('hex');
    const old=db.prepare('SELECT j.id,j.status,p.payload FROM import_jobs j JOIN import_payloads p ON p.job_id=j.id WHERE j.user_id=? AND j.source=? AND p.fingerprint=? LIMIT 1').get(user,source,fingerprint) as {id:string;status:string;payload:string}|undefined;
    if(old)return c.json({id:old.id,status:old.status,...JSON.parse(old.payload)});
    let report:ImportReport;
    try{report=previewCsv(source,text);}catch(error){throw badRequest(error instanceof Error?error.message:'invalid CSV');}
    const existing=db.prepare('SELECT date FROM workouts WHERE user_id=?').all(user) as {date:string}[];
    const dates=new Set(existing.map(row=>row.date));
    const conflicts=report.workouts.filter(workout=>dates.has(workout.date)).map(workout=>workout.date);
    const payload={...report,conflicts};
    const id=randomUUID(),now=Date.now();
    db.transaction(()=>{db.prepare('INSERT INTO import_jobs (id,user_id,source,created_at) VALUES (?,?,?,?)').run(id,user,source,now);db.prepare('INSERT INTO import_payloads (job_id,payload,fingerprint) VALUES (?,?,?)').run(id,JSON.stringify(payload),fingerprint);})();
    return c.json({id,status:'pending',...payload});
  });
  app.post('/gym/import/:source/confirm',c=>command(ctx,c,z.object({id:z.string().uuid(),skip_conflicts:z.boolean(),accept_skipped:z.boolean(),idempotency_key:keySchema}).strict(),(user,input,now)=>{
    const source=z.enum(['hevy','strong']).parse(c.req.param('source'));
    const job=db.prepare('SELECT j.status,p.payload FROM import_jobs j JOIN import_payloads p ON p.job_id=j.id WHERE j.id=? AND j.user_id=? AND j.source=?').get(input.id,user,source) as {status:string;payload:string}|undefined;
    if(!job)throw notFound('import job not found');
    if(job.status==='confirmed')return {data:{ok:true,already_confirmed:true},date:todayWib(now),entityType:'import',entityId:input.id};
    if(job.status!=='pending')throw conflict('import is not pending');
    const report=JSON.parse(job.payload) as ImportReport;
    if(report.errors.length)throw badRequest('fix CSV errors before importing');
    if(report.skipped.length&&!input.accept_skipped)throw badRequest('review and accept skipped rows before importing');
    let imported=0,from=todayWib(now);const skipped:string[]=[];
    for(const workout of report.workouts) {
      if(db.prepare('SELECT 1 FROM workouts WHERE user_id=? AND date=?').get(user,workout.date)) {
        if(!input.skip_conflicts)throw conflict(`${workout.date} already has a gym outcome`);
        skipped.push(workout.date);continue;
      }
      saveWorkout(db,user,workout.date,now,workout,true);if(workout.date<from)from=workout.date;imported++;
    }
    db.prepare("UPDATE import_jobs SET status='confirmed',confirmed_at=? WHERE id=?").run(now,input.id);
    return {data:{ok:true,imported,skipped},date:from,entityType:'import',entityId:input.id,action:'import'};
  }));
  return app;
}
