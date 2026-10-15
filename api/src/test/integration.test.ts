import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, runMigrations, type DB } from '../db.js';
import { buildApp } from '../app.js';
import { createNudgeJobs, dispatchNudges, dueTrackers, allowedPushEndpoint } from '../nudges.js';
import { parseCsv, previewCsv } from '../import-csv.js';
import type { AppCtx } from '../app.js';
import type { ChudEnv } from '../env.js';
import { rebuildDayWindow } from '../settle.js';
import { calendar } from '@chudlog/shared';
let ctx: AppCtx;
let dir: string, db: DB, app: ReturnType<typeof buildApp>;
const migrations = fileURLToPath(new URL('../migrations/', import.meta.url));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chudlog-'));
  db = openDb(join(dir, 'test.db'));
  expect(runMigrations(db.db, migrations).applied).toHaveLength(4);
  expect(runMigrations(db.db, migrations).applied).toHaveLength(0);
  const env: ChudEnv = { nodeEnv:'test',port:8787,host:'127.0.0.1',dbPath:db.path,sessionSecret:'test-only',allowedOrigins:[],publicOrigin:'http://localhost',vapidPublicKey:'',vapidPrivateKeyJwk:'',vapidAdminEmail:'',vapidSub:'',adminEmails:new Set(),staticDir:dir };
  ctx={db,env};app = buildApp(ctx);
});
afterEach(() => { vi.useRealTimers(); db.close(); rmSync(dir, { recursive: true, force: true }); });
async function write(path: string, body: unknown, cookie = '', origin = 'http://localhost', method = 'POST') {
  return app.request(`http://localhost/api${path}`, { method, headers: { 'Content-Type':'application/json', cookie, origin, 'x-forwarded-for': dir }, body: JSON.stringify(body) });
}
async function register() {
  const res = await write('/auth/register', { email:'one@example.com',password:'password123',display_name:'One',group_create:{name:'Friends'} });
  expect(res.status).toBe(201);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { cookie, id:(await res.json()).user.id as string };
}
test('two accounts persist, sessions authenticate, profiles stay scoped and logout revokes', async () => {
  const { cookie, id } = await register();
  expect(cookie).toMatch(/^__Host-cl_session=/);
  const me = await app.request('/api/me', { headers:{cookie} });
  expect(me.status).toBe(200);
  const data = await me.json();
  expect(JSON.stringify(data)).not.toMatch(/pass_hash|pass_salt|token_hash/);
  const second = await write('/auth/register', { email:'two@example.com',password:'password123',display_name:'Two',group_join:{code:data.group.invite_code} });
  expect(second.status).toBe(201);
  const secondCookie = second.headers.get('set-cookie')!.split(';')[0]!;
  const update = await write('/me', {bodyweight_kg:80,sex:'m',age:30,height_cm:180,calorie_goal_mode:'extreme'}, cookie, 'http://localhost', 'PUT');
  expect(update.status).toBe(200);
  const updated = await update.json();
  expect(updated.user.protein_goal).toBe(120);
  expect(updated.warning).toBeTruthy();
  expect((await (await app.request('/api/me',{headers:{cookie:secondCookie}})).json()).user.bodyweight_kg).toBeNull();
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:2});
  expect((db.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(id) as {token_hash:string}).token_hash).not.toBe(cookie.split('=')[1]);
  expect((await write('/auth/logout', {}, cookie)).status).toBe(200);
  expect((await app.request('/api/me',{headers:{cookie}})).status).toBe(401);
  const login = await write('/auth/login',{email:'one@example.com',password:'password123'});
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  db.close(); db = openDb(join(dir,'test.db'));
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:2});
});
test('reject invalid JSON, hostile origins, extra profile fields, and invalid invitations without partial users', async () => {
  const { cookie } = await register();
  expect((await write('/me',{display_name:'x'},cookie,'https://evil.example','PUT')).status).toBe(403);
  expect((await write('/me',{id:'someone-else'},cookie,'http://localhost','PUT')).status).toBe(400);
  expect((await app.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status).toBe(400);
  expect((await write('/auth/register',{email:'bad@example.com',password:'password123',display_name:'Bad',group_join:{code:'BADCODE1'}})).status).toBe(404);
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:1});
});
function seedDay(id: string, date: string, kind = 'workout', late = false) {
  const ts = calendar.dayDeadline(date, 'Asia/Jakarta') - (late ? 0 : 3600000);
  const key = `${id}-${date}`;
  db.db.prepare('INSERT INTO sleep (id,user_id,date,submitted_at,bed_ts,wake_ts,duration_min,color) VALUES (?,?,?,?,?,?,?,?)').run(key,id,date,ts,ts-36000000,ts-7200000,480,'red');
  db.db.prepare('INSERT INTO meals (id,user_id,date,submitted_at,ts) VALUES (?,?,?,?,?)').run(key,id,date,ts,ts);
  db.db.prepare('INSERT INTO meal_rows (id,meal_id,name,norm_name,amount,kcal,protein_g) VALUES (?,?,?,?,?,?,?)').run(key,key,'rice','rice','bowl',200,4);
  db.db.prepare('INSERT INTO workouts (id,user_id,date,submitted_at,started_ts,kind) VALUES (?,?,?,?,?,?)').run(key,id,date,ts,ts,kind);
  if(kind === 'workout') db.db.prepare('INSERT INTO exercise_sets (id,workout_id,exercise,muscle,set_no,kg,reps) VALUES (?,?,?,?,?,?,?)').run(key,key,'Squat','legs',1,60,5);
}
test('overlapping rebuilds converge, REST keeps streak, late entries cannot farm points, corrections recompute longest', async () => {
  const { id } = await register();
  // Remove the registration projection so the fixture has one contiguous historical window.
  db.db.prepare('DELETE FROM day_log WHERE user_id=?').run(id);
  for(let n=1;n<=8;n++) seedDay(id,`2026-10-0${n}`,n === 3 ? 'rest' : 'workout');
  const nowMs = Date.parse('2026-10-08T16:00:00Z');
  const rebuild = (fromDate='2026-10-01') => rebuildDayWindow(db.db,id,{fromDate,toDate:'2026-10-08',nowMs});
  rebuild();
  const snapshot = () => ({rank:db.db.prepare('SELECT * FROM rank_state WHERE user_id=?').get(id),days:db.db.prepare('SELECT * FROM day_log WHERE user_id=? ORDER BY date').all(id)});
  const first = snapshot(); rebuild(); expect(snapshot()).toEqual(first); rebuild('2026-10-05'); expect(snapshot()).toEqual(first);
  expect(first.rank).toMatchObject({current_streak:8,longest_streak:8,lifetime_points:90});
  expect(db.db.prepare('SELECT points_earned FROM day_log WHERE user_id=? AND date=?').get(id,'2026-10-03')).toEqual({points_earned:0});
  db.db.prepare('DELETE FROM sleep WHERE user_id=? AND date=?').run(id,'2026-10-04'); rebuild('2026-10-04');
  expect(snapshot().rank).toMatchObject({current_streak:4,longest_streak:4,lifetime_points:70});
  seedDay(id,'2026-10-09','workout',true);
  rebuildDayWindow(db.db,id,{fromDate:'2026-10-09',toDate:'2026-10-09',nowMs:calendar.dayDeadline('2026-10-09','Asia/Jakarta')});
  expect(db.db.prepare('SELECT lit,points_earned FROM day_log WHERE user_id=? AND date=?').get(id,'2026-10-09')).toEqual({lit:0,points_earned:0});
});
test('session expiration, payload limits and independent private group creation', async () => {
  const { cookie } = await register();
  const duplicate = await write('/auth/register',{email:'new@example.com',password:'password123',display_name:'New',group_create:{name:'Other'}});
  expect(duplicate.status).toBe(201);
  const newCookie = duplicate.headers.get('set-cookie')!.split(';')[0]!;
  const original = await (await app.request('/api/me', {headers:{cookie}})).json();
  const independent = await (await app.request('/api/me', {headers:{cookie:newCookie}})).json();
  expect(independent.group.name).toBe('Other');
  expect(independent.group.id).not.toBe(original.group.id);
  expect(independent.group.invite_code).not.toBe(original.group.invite_code);
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?').get(independent.user.id)).toEqual({n:1});
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({n:2});
  const large = await write('/me',{display_name:'x'.repeat(270000)},cookie,'http://localhost','PUT');
  expect(large.status).toBe(413);
  db.db.prepare('UPDATE sessions SET expires_at = 0').run();
  expect((await app.request('/api/me',{headers:{cookie}})).status).toBe(401);
});
test('an unfinished current day preserves yesterday’s streak until the deadline', async () => {
  const { id } = await register();
  db.db.prepare('DELETE FROM day_log WHERE user_id=?').run(id);
  seedDay(id,'2026-10-01','rest');
  rebuildDayWindow(db.db,id,{fromDate:'2026-10-01',toDate:'2026-10-02',nowMs:Date.parse('2026-10-02T08:00:00Z')});
  expect(db.db.prepare('SELECT current_streak FROM rank_state WHERE user_id=?').get(id)).toEqual({current_streak:1});
  rebuildDayWindow(db.db,id,{fromDate:'2026-10-02',toDate:'2026-10-02',nowMs:calendar.dayDeadline('2026-10-02','Asia/Jakarta')});
  expect(db.db.prepare('SELECT current_streak FROM rank_state WHERE user_id=?').get(id)).toEqual({current_streak:0});
});
test('successive season resets carry half the previous season score and survive replay', async () => {
  const { id } = await register();
  db.db.prepare('DELETE FROM day_log WHERE user_id=?').run(id);
  seedDay(id,'2026-03-31'); seedDay(id,'2026-04-01'); seedDay(id,'2026-07-01');
  const opts = {fromDate:'2026-03-31',toDate:'2026-07-01',nowMs:Date.parse('2026-07-01T16:30:00Z')};
  rebuildDayWindow(db.db,id,opts);
  const state = db.db.prepare('SELECT season_id,season_points,lifetime_points FROM rank_state WHERE user_id=?').get(id);
  expect(state).toEqual({season_id:'2026-Q3',season_points:17,lifetime_points:30});
  rebuildDayWindow(db.db,id,opts);
  expect(db.db.prepare('SELECT season_id,season_points,lifetime_points FROM rank_state WHERE user_id=?').get(id)).toEqual(state);
});

// End-to-end activity flows against real SQLite, with a controlled server clock.
function at(stamp:string) {vi.useFakeTimers();vi.setSystemTime(new Date(stamp));}
const validRow={name:'Rice and eggs',amount:'1 bowl',kcal:450,protein_g:24};
function nightFor(date:string) {return {bed_ts:Date.parse(`${date}T00:00:00+07:00`),wake_ts:Date.parse(`${date}T06:00:00+07:00`)};}
function workoutBody(key:string) {return {started_ts:Date.now()-3600000,exercises:[{exercise:'Squat',muscle:'quads',sets:[{kg:60,reps:5}]}],idempotency_key:key};}

test('a red night, food below target and REST complete a real day; workout replacement awards once',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie,id}=await register();
  expect((await write('/sleep',{...nightFor('2026-10-15'),idempotency_key:'sleep-001'},cookie)).status).toBe(200);
  expect((await write('/food/entries',{rows:[{...validRow,kcal:0,protein_g:0}],idempotency_key:'meal-001'},cookie)).status).toBe(200);
  expect((await write('/gym/rest',{reason:'Recovery',idempotency_key:'rest-001'},cookie)).status).toBe(200);
  const me=await(await app.request('/api/me',{headers:{cookie}})).json();
  expect(me.today).toMatchObject({food:1,sleep:1,gym:1,lit:1,points_earned:0});
  const payload=workoutBody('workout-001');
  const first=await(await write('/gym/workouts',payload,cookie)).json();
  const second=await(await write('/gym/workouts',payload,cookie)).json();
  expect(second).toEqual(first);
  expect(db.db.prepare('SELECT lifetime_points,current_streak FROM rank_state WHERE user_id=?').get(id)).toEqual({lifetime_points:10,current_streak:1});
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id=?').get(id)).toEqual({n:1});
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM log_events WHERE user_id=? AND action='rest-replace'").get(id)).toEqual({n:1});
  expect((await write('/gym/workouts',{...payload,notes:'changed'},cookie)).status).toBe(409);
  expect((await write('/gym/workouts',{...workoutBody('warmup-only'),exercises:[{exercise:'Squat',muscle:'quads',sets:[{kg:60,reps:5,warmup:true}]}]},cookie)).status).toBe(400);
});
test('empty meal containers cannot backdate food rows, and late REST replacements cannot earn points',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie,id}=await register();
  const meal=await(await write('/food/meals',{idempotency_key:'container-001'},cookie)).json();
  await write('/sleep',nightFor('2026-10-15'),cookie);
  const rest=await(await write('/gym/rest',{},cookie)).json();
  at('2026-10-15T17:01:00Z');
  expect((await write(`/food/meals/${meal.id}/rows`,{row:validRow,idempotency_key:'late-row-001'},cookie)).status).toBe(200);
  const historical={...workoutBody('late-workout-001'),started_ts:Date.parse('2026-10-15T09:00:00Z')};
  expect((await write(`/gym/workouts/${rest.id}`,historical,cookie)).status).toBe(200);
  expect(db.db.prepare('SELECT food,sleep,gym,lit,points_earned FROM day_log WHERE user_id=? AND date=?').get(id,'2026-10-15')).toEqual({food:1,sleep:1,gym:1,lit:0,points_earned:0});
});
test('cross-owner mutations are rejected; group DTOs exclude sensitive profile and auth data',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie}=await register();
  const owner=await(await app.request('/api/me',{headers:{cookie}})).json();
  const joined=await write('/auth/register',{email:'joined@example.test',password:'password123',display_name:'Joined',group_join:{code:owner.group.invite_code}});
  const joinedCookie=joined.headers.get('set-cookie')!.split(';')[0]!;
  const stranger=await write('/auth/register',{email:'outside@example.test',password:'password123',display_name:'Outside',group_create:{name:'Outside'}});
  const outsideCookie=stranger.headers.get('set-cookie')!.split(';')[0]!;
  const meal=await(await write('/food/entries',{rows:[validRow]},cookie)).json();
  expect((await write(`/food/meals/${meal.id}`,{rows:[validRow]},joinedCookie,'http://localhost','PUT')).status).toBe(404);
  expect((await write(`/food/meals/${meal.id}`,{},outsideCookie,'http://localhost','DELETE')).status).toBe(404);
  const member=await app.request(`/api/group/members/${owner.user.id}`,{headers:{cookie:joinedCookie}});
  expect(member.status).toBe(200);
  expect(JSON.stringify(await member.json())).not.toMatch(/email|pass_hash|pass_salt|bodyweight_kg|height_cm|token_hash/);
  expect((await app.request(`/api/group/members/${owner.user.id}`,{headers:{cookie:outsideCookie}})).status).toBe(404);
  const exported=await(await app.request('/api/me/export',{headers:{cookie:joinedCookie}})).json();
  expect(exported.profile.email).toBe('joined@example.test');expect(exported.meals).toEqual([]);
  expect(JSON.stringify(exported)).not.toMatch(/pass_hash|pass_salt|token_hash|push_subs/);
});
test('saved foods deduplicate exactly, suggest similar names, and preserve logged nutrition snapshots',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie}=await register();
  const body={name:'Chicken rice',default_amount:'1 bowl',kcal:500,protein_g:30};
  const first=await(await write('/foods/save',body,cookie)).json();
  const exact=await(await write('/foods/save',{...body,name:'CHICKEN RICE!',kcal:999},cookie)).json();
  expect(exact.food.id).toBe(first.food.id);expect(exact.food.kcal).toBe(500);
  const similar=await(await write('/foods/save',{...body,name:'Chicken rice special'},cookie)).json();
  expect(similar.suggestions).toHaveLength(1);
  const confirmed=await write('/foods/save',{...body,name:'Chicken rice special',confirm_new:true},cookie);
  expect(confirmed.status).toBe(200);
  await write('/food/entries',{rows:[{...validRow,source_food_id:first.food.id,kcal:500}]},cookie);
  await write(`/foods/${first.food.id}`,{},cookie,'http://localhost','DELETE');
  const day=await(await app.request('/api/food/day',{headers:{cookie}})).json();
  expect(day.totals.kcal).toBe(500);
});
test('one-day restore bridges continuity without inventing compliance or points; one per month',async()=>{
  at('2026-10-03T10:00:00Z');const {cookie,id}=await register();
  seedDay(id,'2026-10-01','rest');seedDay(id,'2026-10-03','rest');
  const today=await(await app.request('/api/today',{headers:{cookie}})).json();
  expect(today.restore).toEqual({date:'2026-10-02',month:'2026-10'});
  expect((await write('/streak/restore',{date:'2026-10-02',idempotency_key:'restore-001'},cookie)).status).toBe(200);
  expect(db.db.prepare('SELECT current_streak,lifetime_points FROM rank_state WHERE user_id=?').get(id)).toEqual({current_streak:2,lifetime_points:0});
  expect(db.db.prepare('SELECT lit,restore_used,points_earned FROM day_log WHERE user_id=? AND date=?').get(id,'2026-10-02')).toEqual({lit:0,restore_used:1,points_earned:0});
  at('2026-10-05T10:00:00Z');seedDay(id,'2026-10-05','rest');
  expect((await write('/streak/restore',{date:'2026-10-04'},cookie)).status).toBe(409);
});
test('routine planning does not log gym; own routines and known exercises remain scoped',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie}=await register();
  const routine={name:'Push day',kind:'weekday',weekday:4,exercises:[{exercise:'Barbell bench press',muscle:'chest',sets:[{kg:40,reps:8}]}],idempotency_key:'routine-001'};
  const saved=await(await write('/gym/routines',routine,cookie)).json();expect(saved.routines).toHaveLength(1);
  const today=await(await app.request('/api/gym/today',{headers:{cookie}})).json();expect(today.workout).toBeNull();
  const list=await(await app.request('/api/gym/routines',{headers:{cookie}})).json();expect(list.suggested.name).toBe('Push day');
  const exercises=await(await app.request('/api/gym/exercises',{headers:{cookie}})).json();expect(exercises.exercises).toHaveLength(100);
});
test('CSV previews and confirmation are scoped, idempotent, and cannot award historical points',async()=>{
  at('2026-10-15T10:00:00Z');const {cookie,id}=await register();
  const csv='title,start_time,exercise_title,weight_kg,reps,set_type\r\n"Push, day","14 Oct 2026, 17:00",Barbell bench press,40,8,normal\r\n';
  const preview=await app.request('/api/gym/import/hevy',{method:'POST',headers:{cookie,'Content-Type':'text/csv'},body:csv});expect(preview.status).toBe(200);
  const report=await preview.json();expect(report.errors).toHaveLength(0);expect(report.workouts[0].date).toBe('2026-10-14');
  const input={id:report.id,skip_conflicts:true,accept_skipped:true,idempotency_key:'import-001'};
  const first=await(await write('/gym/import/hevy/confirm',input,cookie)).json();expect(first.imported).toBe(1);
  const second=await(await write('/gym/import/hevy/confirm',input,cookie)).json();expect(second).toEqual(first);
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id=?').get(id)).toEqual({n:1});
  expect(db.db.prepare('SELECT lifetime_points FROM rank_state WHERE user_id=?').get(id)).toEqual({lifetime_points:0});
  const stats=await(await app.request('/api/gym/stats?range=30',{headers:{cookie}})).json();expect(stats.workouts).toBe(1);expect(stats.total_volume).toBe(320);
  expect(parseCsv('a,b\r\n"x,y","a""b"\r\n')[1]).toEqual(['x,y','a"b']);
  expect(()=>parseCsv('a,b\n"broken')).toThrow('unterminated');
  expect(previewCsv('strong','Date,Exercise Name,Weight,Reps\n2026-10-14 15:30:00,Squat,-10,5',Date.now()).errors).toHaveLength(1);
  for(const invalid of ['2026-02-30 15:30:00','30 Feb 2026, 15:30','2026-02-30T15:30:00Z','2026-10-14 24:00:00'])expect(previewCsv('strong',`Date,Exercise Name,Weight,Reps\n"${invalid}",Squat,50,5`,Date.now()).errors).toHaveLength(1);
});
test('nudges bundle owed trackers once per hour and retry only failed subscriptions',async()=>{
  at('2026-10-15T01:00:00Z');const {id,cookie}=await register();
  expect(dueTrackers(undefined,7)).toEqual([]);expect(dueTrackers(undefined,8)).toEqual(['sleep','gym']);expect(dueTrackers(undefined,13)).toEqual(['sleep','gym','food']);expect(dueTrackers(undefined,24)).toEqual([]);
  expect(allowedPushEndpoint('https://127.0.0.1/private')).toBe(false);expect(allowedPushEndpoint('https://fcm.googleapis.com.evil.example/push')).toBe(false);
  for(const device of ['one','two'])db.db.prepare('INSERT INTO push_subs (user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?)').run(id,`https://fcm.googleapis.com/fcm/send/${device}`,'test-key','test-auth',Date.now());
  expect(createNudgeJobs(ctx,Date.now())).toBe(1);expect(createNudgeJobs(ctx,Date.now())).toBe(0);
  const calls:string[]=[];
  await dispatchNudges(ctx,Date.now(),async sub=>{calls.push(sub.endpoint);if(sub.endpoint.endsWith('two'))throw {statusCode:503};});
  expect(calls).toHaveLength(2);
  vi.setSystemTime(Date.now()+16000);
  await dispatchNudges(ctx,Date.now(),async sub=>{calls.push(sub.endpoint);});
  expect(calls.filter(url=>url.endsWith('one'))).toHaveLength(1);expect(calls.filter(url=>url.endsWith('two'))).toHaveLength(2);
  expect(db.db.prepare('SELECT status FROM nudge_log WHERE user_id=?').get(id)).toEqual({status:'accepted'});
  for(let hour=9;hour<=23;hour++){vi.setSystemTime(new Date(`2026-10-15T${String(hour-7).padStart(2,'0')}:00:00Z`));createNudgeJobs(ctx,Date.now());}
  expect(db.db.prepare('SELECT COUNT(*) AS n FROM nudge_log WHERE user_id=?').get(id)).toEqual({n:16});
});
test('operator-issued recovery tokens expire, are single use, and revoke existing sessions',async()=>{
  const {issueReset}=await import('../recovery.js');
  at('2026-10-15T10:00:00Z');const {cookie}=await register();
  const token=issueReset(db.db,'one@example.com');
  expect((await write('/auth/reset',{token,password:'replacement-password'},cookie)).status).toBe(200);
  expect((await app.request('/api/me',{headers:{cookie}})).status).toBe(401);
  expect((await write('/auth/reset',{token,password:'another-password'})).status).toBe(400);
  expect((await write('/auth/login',{email:'one@example.com',password:'replacement-password'})).status).toBe(200);
  const expired=issueReset(db.db,'one@example.com');vi.setSystemTime(Date.now()+31*60000);
  expect((await write('/auth/reset',{token:expired,password:'replacement-again'})).status).toBe(400);
});
test('encrypted SQLite snapshots restore and detect tampering, and audit rows are immutable',async()=>{
  const {encryptedBackup,restoreBackup}=await import('../backup.js');
  const {readFileSync,writeFileSync}=await import('node:fs');
  const {randomBytes}=await import('node:crypto');
  await register();const secret=randomBytes(32).toString('base64'),file=join(dir,'encrypted.clbak');
  await encryptedBackup(db.db,file,secret);
  expect(readFileSync(file).includes(Buffer.from('one@example.com'))).toBe(false);
  expect(restoreBackup(file,join(dir,'restored.db'),secret).users).toBe(1);
  const corrupted=readFileSync(file);corrupted[corrupted.length-1]=corrupted[corrupted.length-1]!^1;writeFileSync(join(dir,'corrupted'),corrupted);
  expect(()=>restoreBackup(join(dir,'corrupted'),join(dir,'bad.db'),secret)).toThrow();
  const user=(db.db.prepare('SELECT id FROM users').get() as {id:string}).id;
  db.db.prepare("INSERT INTO log_events (id,user_id,entity_type,entity_id,action,occurred_at,date) VALUES ('audit',?,'test','test','create',?,'2026-10-15')").run(user,Date.now());
  expect(()=>db.db.prepare("DELETE FROM log_events WHERE id='audit'").run()).toThrow('immutable');
});
