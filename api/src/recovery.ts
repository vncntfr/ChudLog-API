import { createHash,randomBytes } from 'node:crypto';
import type { SQLiteDb } from './db.js';
import { hashPasswordSync, revokeSession } from './auth.js';
import { appendLogEvent, todayWib } from './settle.js';
import { badRequest, notFound } from './errors.js';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
/** Local operator use only. No unauthenticated endpoint issues or returns reset secrets. */
export function issueReset(db:SQLiteDb,email:string,now=Date.now()) {
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase()) as {id:string}|undefined;
  if(!user)throw notFound('account not found');
  const token=randomBytes(32).toString('base64url');
  db.transaction(()=>{
    db.prepare('UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(now,user.id);
    db.prepare('INSERT INTO password_resets (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(digest(token),user.id,now,now+30*60000);
    appendLogEvent(db,{userId:user.id,entityType:'password-reset',entityId:user.id,action:'create',date:todayWib(now),occurredAt:now});
  })();
  return token;
}
export function consumeReset(db:SQLiteDb,token:string,password:string,now=Date.now()) {
  db.transaction(()=>{
    const reset=db.prepare('SELECT user_id,expires_at,consumed_at FROM password_resets WHERE token_hash=?').get(digest(token)) as {user_id:string;expires_at:number;consumed_at:number|null}|undefined;
    if(!reset||reset.consumed_at!==null||reset.expires_at<=now)throw badRequest('invalid or expired recovery token');
    const hashed=hashPasswordSync(password);
    db.prepare('UPDATE users SET pass_salt=?,pass_hash=? WHERE id=?').run(hashed.salt,hashed.hash,reset.user_id);
    db.prepare('UPDATE password_resets SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(now,reset.user_id);
    revokeSession(db,undefined,reset.user_id);
    appendLogEvent(db,{userId:reset.user_id,entityType:'password-reset',entityId:reset.user_id,action:'update',date:todayWib(now),occurredAt:now});
  }).immediate();
}
