import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { SQLiteDb } from './db.js';
const MAGIC=Buffer.from('CHUDLOG1');
function key(raw:string) {const bytes=Buffer.from(raw,'base64');if(bytes.length!==32)throw new Error('BACKUP_ENCRYPTION_KEY must encode exactly 32 random bytes');return bytes;}
export async function encryptedBackup(db:SQLiteDb,destination:string,secret:string) {
  const cipherKey=key(secret),temp=resolve(tmpdir(),`chudlog-backup-${randomUUID()}.db`),target=resolve(destination);
  if(existsSync(target))throw new Error('backup destination already exists');
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  try {
    await db.backup(temp);chmodSync(temp,0o600);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cipherKey,iv);
    const encrypted=Buffer.concat([cipher.update(readFileSync(temp)),cipher.final()]);
    writeFileSync(target,Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]),{mode:0o600,flag:'wx'});
  }finally{rmSync(temp,{force:true});}
}
export function restoreBackup(source:string,destination:string,secret:string) {
  const target=resolve(destination);if(existsSync(target))throw new Error('restore only into a new scratch path');
  const bytes=readFileSync(source);if(!bytes.subarray(0,8).equals(MAGIC))throw new Error('not a ChudLog encrypted backup');
  const decipher=createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(8,20));decipher.setAuthTag(bytes.subarray(20,36));
  const plain=Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);
  mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,plain,{mode:0o600,flag:'wx'});
  let db:Database.Database|undefined;
  try {
    db=new Database(target,{readonly:true});
    const check=db.pragma('integrity_check',{simple:true});if(check!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('restored database failed integrity checks');
    return {users:(db.prepare('SELECT COUNT(*) AS n FROM users').get() as {n:number}).n,events:(db.prepare('SELECT COUNT(*) AS n FROM log_events').get() as {n:number}).n};
  }catch(error){db?.close();db=undefined;rmSync(target,{force:true});throw error;}finally{db?.close();}
}
