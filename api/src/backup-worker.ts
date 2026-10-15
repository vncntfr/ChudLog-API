import { resolve } from 'node:path';
import { calendar } from '@chudlog/shared';
import type { AppCtx } from './app.js';
import { encryptedBackup } from './backup.js';
/** Optional daily encrypted snapshots. Operator configures the target (off-box mount recommended). */
export function startBackupWorker(ctx:AppCtx) {
  const target=ctx.env.backupDirectory,secret=ctx.env.backupKey;
  if(!target||!secret)return ()=>{};
  let running=false;
  const tick=async()=>{
    if(running)return;
    const now=Date.now(),clock=calendar.zonedInstant(now,'Asia/Jakarta');
    if(clock.hour<2)return;
    const previous=ctx.db.db.prepare("SELECT value FROM meta WHERE key='backup:last_day'").get() as {value:string}|undefined;
    if(previous?.value===clock.date)return;
    running=true;
    try {
      await encryptedBackup(ctx.db.db,resolve(target,`chudlog-${clock.date}-${now}.clbak`),secret);
      ctx.db.db.prepare("INSERT INTO meta (key,value) VALUES ('backup:last_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(clock.date);
      ctx.db.db.prepare("INSERT INTO meta (key,value) VALUES ('backup:last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
      ctx.db.db.prepare("DELETE FROM meta WHERE key='backup:last_failure'").run();
    }catch {
      ctx.db.db.prepare("INSERT INTO meta (key,value) VALUES ('backup:last_failure',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now));
      console.error('daily encrypted backup failed; operator action required');
    }finally{running=false;}
  };
  void tick();const timer=setInterval(()=>void tick(),60000);timer.unref();return()=>clearInterval(timer);
}
