import { Hono } from 'hono';
import { z } from 'zod';
import * as webpush from 'web-push';
import type { AppCtx } from '../app.js';
import type { ApiEnv } from '../activity.js';
import { allowedPushEndpoint } from '../nudges.js';
import { badRequest, conflict, tooMany } from '../errors.js';
import { rateLimitAllow } from '../rate-limit.js';

export function buildNotificationRoutes(ctx:AppCtx) {
  const app=new Hono<ApiEnv>(),db=ctx.db.db;
  const subscription=z.object({endpoint:z.string().url().max(2048),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/),auth:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/)})}).strict();
  app.get('/push/status',c=>c.json({configured:Boolean(ctx.env.vapidPublicKey&&ctx.env.vapidPrivateKeyJwk),subscriptions:(db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?').get(c.get('User')!.id) as {n:number}).n}));
  app.post('/push/subscribe',async c=>{
    if(!ctx.env.vapidPublicKey||!ctx.env.vapidPrivateKeyJwk)return c.json({error:'Push is not configured on this server yet.'},503);
    const input=subscription.parse(await c.req.json()),user=c.get('User')!.id;
    if(!allowedPushEndpoint(input.endpoint))throw badRequest('unsupported push provider');
    const publicKey=Buffer.from(input.keys.p256dh,'base64url'),auth=Buffer.from(input.keys.auth,'base64url');
    if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw badRequest('invalid subscription keys');
    const existing=db.prepare('SELECT user_id FROM push_subs WHERE endpoint=?').get(input.endpoint) as {user_id:string}|undefined;
    if(existing&&existing.user_id!==user)throw conflict('this device is subscribed to a different account; unsubscribe it before switching');
    db.prepare('INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth').run(user,input.endpoint,input.keys.p256dh,input.keys.auth,Date.now());
    return c.json({ok:true});
  });
  app.delete('/push/subscribe',async c=>{
    const input=z.object({endpoint:z.string().url().max(2048)}).strict().parse(await c.req.json());
    db.prepare('DELETE FROM push_subs WHERE user_id=? AND endpoint=?').run(c.get('User')!.id,input.endpoint);return c.json({ok:true});
  });
  app.post('/push/test',async c=>{
    const user=c.get('User')!.id;
    if(!rateLimitAllow({key:`push-test:${user}`,max:3,windowMs:3600000}))throw tooMany('three push tests per hour');
    if(!ctx.env.vapidPublicKey||!ctx.env.vapidPrivateKeyJwk)return c.json({error:'Push is not configured on this server yet.'},503);
    webpush.setVapidDetails(ctx.env.vapidSub,ctx.env.vapidPublicKey,ctx.env.vapidPrivateKeyJwk);
    const subs=db.prepare('SELECT endpoint,p256dh,auth FROM push_subs WHERE user_id=?').all(user) as {endpoint:string;p256dh:string;auth:string}[];
    let accepted=0;
    for(const sub of subs) {
      if(!allowedPushEndpoint(sub.endpoint))continue;
      try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title:'ChudLog',body:'ChudLog push works.',tag:'chudlog-test',data:{deepLink:'/',userId:user}}),{TTL:60,timeout:10000});accepted++;}
      catch(err){if([404,410].includes((err as {statusCode:number}).statusCode))db.prepare('DELETE FROM push_subs WHERE user_id=? AND endpoint=?').run(user,sub.endpoint);}
    }
    return c.json({accepted,subscriptions:subs.length});
  });
  return app;
}
