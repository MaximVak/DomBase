import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {eq,sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/d1';
import {configPath,projectRoot,runLocalDb} from '../scripts/local-db.mjs';
import {loadServerModule} from '../scripts/server-runtime.mjs';
import {seedWorkforceFixture,fieldKey} from './support/workforce-fixture.mjs';
import {startAuthApp} from './support/auth-app-fixture.mjs';
async function seed(db,s,load,password){
 const f=await seedWorkforceFixture(db,s,load,password);const[pub]=await db.insert(s.schedulePublications).values({version:1,publishedByAccountId:f.owner.id}).returning();
 const shifts=await db.insert(s.shifts).values([
  {employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,date:'2026-11-12',startTime:'09:00',endTime:'17:00',publicationId:pub.id,notes:'PRIVATE SHIFT'},
  {employeeId:f.b.id,roleId:f.roleB.id,roleName:f.roleB.name,date:'2026-11-12',startTime:'10:00',endTime:'18:00',publicationId:pub.id},
  {employeeId:f.multi.id,roleId:f.roleB.id,roleName:'HIDDEN MULTI JOB',date:'2026-11-13',startTime:'08:00',endTime:'12:00',publicationId:pub.id},
  {employeeId:f.a.id,roleId:f.roleA.id,roleName:'LEGACY UNPUBLISHED',date:'2026-11-14',startTime:'06:00',endTime:'07:00'},
 ]).returning();
 for(const[actor,label]of [[f.owner,'OWNER DRAFT'],[f.manager,'MANAGER DRAFT']]){const[d]=await db.insert(s.scheduleDrafts).values({ownerAccountId:actor.id}).returning();await db.insert(s.scheduleDraftChanges).values({draftId:d.id,clientKey:String(shifts[0].id),shiftId:shifts[0].id,operation:'upsert',employeeId:f.a.id,roleId:f.roleA.id,roleName:label,date:'2026-11-12',startTime:'22:00',endTime:'06:00',notes:'PRIVATE DRAFT NOTE'});}
 await db.insert(s.ptoRequests).values({employeeId:f.a.id,compensation:'unpaid',startDate:'2026-11-12',endDate:'2026-11-12',reason:'sick_emergency',explanation:'PRIVATE MEDICAL',status:'approved'});
 await db.insert(s.openShifts).values({roleId:f.roleA.id,date:'2026-11-12',startTime:'12:00',endTime:'16:00',publicationId:pub.id,createdByAccountId:f.owner.id,notes:'PRIVATE OPEN NOTE'});
 await db.insert(s.scheduleEvents).values({date:'2026-11-12',title:'Fictional event',notes:'PRIVATE EVENT NOTE',createdByAccountId:f.owner.id});return{...f,printedShifts:shifts};
}
test('native schedule print rechecks permissions, scopes, publication and own drafts without writes or private projections',{timeout:120000},async t=>{
 await mkdir(join(projectRoot,'.wrangler'),{recursive:true});const statePath=await mkdtemp(join(projectRoot,'.wrangler/s10-test-'));let platform;
 t.after(async()=>{try{await platform?.dispose();}finally{await rm(statePath,{recursive:true,force:true});}});await runLocalDb('migrate',[],statePath);
 const s=await loadServerModule('db/schema.ts'),runtime=await loadServerModule('tests/support/workforce-runtime.ts'),{getPlatformProxy}=await import('wrangler');
 platform=await getPlatformProxy({configPath,persist:{path:join(statePath,'v3')},remoteBindings:false,envFiles:[]});const db=drizzle(platform.env.DB,{schema:s}),password='Fictional print test passphrase!',secret='isolated-print-test-secret-at-least-32-characters';
 const f=await seed(db,s,loadServerModule,password),auth=runtime.createAuthService(db,{secret}),access=runtime.createAccessService(db,auth),workspace=runtime.createWorkforceService(db,access,{secret,fieldKey}),origin='http://localhost:3000';
 const request=(path,cookie='',body)=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
 const ok=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));assert.match(response.headers.get('cache-control'),/no-store/);return data;};
 const login=async account=>{const response=await auth.handle(request('/api/auth/login','',{email:account.email,password}));await ok(response);return response.headers.get('set-cookie').split(';')[0];};
 const owner=await login(f.owner),manager=await login(f.manager),employee=await login(f.employeeAccount),path='/api/workspace/schedule-print?date=2026-11-12&view=week',call=(cookie=owner,extra='')=>workspace.handle(request(path+extra,cookie));
 const before=JSON.stringify(await db.all(sql`SELECT (SELECT count(*) FROM shifts) shifts,(SELECT count(*) FROM schedule_publications) publications,(SELECT count(*) FROM audit_log) audit,(SELECT count(*) FROM schedule_emails) emails,(SELECT count(*) FROM clock_events) punches`));
 await t.test('published default excludes legacy unpublished work, all notes/wages/profiles and preserves conflicting time off',async()=>{
  const data=await ok(await call()),text=JSON.stringify(data);assert.equal(data.draft,false);assert.match(text,/9:00 AM - 5:00 PM/);assert.match(text,/Approved time off/);assert.match(text,/Open shifts/);assert.match(text,/Fictional event/);assert.doesNotMatch(text,/PRIVATE (?:SHIFT|DRAFT|OPEN|EVENT|MEDICAL)|LEGACY UNPUBLISHED|OWNER DRAFT|MANAGER DRAFT|"(?:ssn|wage|email|phone|objectKey|explanation)"/);
 });
 await t.test('current department scope also restricts another department job for a shared employee and forged selections',async()=>{
  const data=await ok(await call(manager));assert.doesNotMatch(JSON.stringify(data),/Other department private worker|HIDDEN MULTI JOB|Job B/);assert.equal((await call(manager,'&employees='+f.b.id)).status,404);
  const filtered=await ok(await call(owner,'&employees='+f.a.id));assert.doesNotMatch(JSON.stringify(filtered),/Other department private worker/);assert.match(JSON.stringify(filtered),/Open shifts/);assert.equal((await ok(await call(owner,'&employees='))).scope,'0 selected team members');
 });
 await t.test('drafts are explicit, only this account draft prints, and read-only access cannot request them',async()=>{
  const a=await ok(await call(owner,'&draft=true')),b=await ok(await call(manager,'&draft=true'));assert.equal(a.draft,true);assert.match(JSON.stringify(a),/OWNER DRAFT|ends next day/);assert.doesNotMatch(JSON.stringify(a),/MANAGER DRAFT/);assert.match(JSON.stringify(b),/MANAGER DRAFT/);assert.doesNotMatch(JSON.stringify(b),/OWNER DRAFT/);
  await db.insert(s.accountPermissions).values({accountId:f.manager.id,permission:'schedule.manage',allowed:false}).onConflictDoUpdate({target:[s.accountPermissions.accountId,s.accountPermissions.permission],set:{allowed:false}});
  assert.equal((await ok(await call(manager))).canPrintDraft,false);assert.equal((await call(manager,'&draft=true')).status,403);
 });
 await t.test('anonymous/Employee/tablet credentials, malformed dates/selectors, duplicate options and writes fail closed',async()=>{
  assert.equal((await call('')).status,401);assert.equal((await call(employee)).status,401);assert.equal((await call('dombase-kiosk-device='+f.deviceToken)).status,403);
  for(const extra of ['&date=2026-11-13','&employeeId=1','&employees=1,1','&employees=-1','&draft=yes','&view=year'])assert.equal((await call(owner,extra)).status,400,extra);
  assert.equal((await workspace.handle(request('/api/workspace/schedule-print?date=2026-02-30',owner))).status,400);assert.equal((await workspace.handle(request(path,owner,{}))).status,405);
 });
 await t.test('revoked schedule and leave grants apply immediately; captured sessions cannot print after disable',async()=>{
  await db.insert(s.accountPermissions).values({accountId:f.manager.id,permission:'time_off.read',allowed:false}).onConflictDoUpdate({target:[s.accountPermissions.accountId,s.accountPermissions.permission],set:{allowed:false}});assert.doesNotMatch(JSON.stringify(await ok(await call(manager))),/Approved time off/);
  await db.insert(s.accountPermissions).values({accountId:f.manager.id,permission:'schedule.read',allowed:false}).onConflictDoUpdate({target:[s.accountPermissions.accountId,s.accountPermissions.permission],set:{allowed:false}});assert.equal((await call(manager)).status,403);
  const ctx=await access.workspaceContext(request(path,owner));await db.update(s.accounts).set({loginEnabled:false}).where(eq(s.accounts.id,f.owner.id));const{readSchedulePrint}=await loadServerModule('workforce/schedule-print.ts');await assert.rejects(readSchedulePrint(db,ctx,new URL(origin+path),fieldKey,Date.now()),e=>e.status===401);
 });
 assert.equal(JSON.stringify(await db.all(sql`SELECT (SELECT count(*) FROM shifts) shifts,(SELECT count(*) FROM schedule_publications) publications,(SELECT count(*) FROM audit_log) audit,(SELECT count(*) FROM schedule_emails) emails,(SELECT count(*) FROM clock_events) punches`)),before);
});
test('built Worker serves authenticated print page and scoped print JSON while denying Employee management print',{timeout:120000},async t=>{
 const app=await startAuthApp({seed});t.after(app.close);const f=app.fixtureData;
 const login=async email=>{const r=await fetch(app.origin+'/api/auth/login',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({email,password:app.password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const owner=await login(app.email),employee=await login(f.employeeAccount.email),call=(path,cookie='')=>fetch(app.origin+path,{headers:{Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(20000)});
 assert.equal((await call('/schedule/print')).status,307);const page=await call('/schedule/print?date=2026-11-12',owner);assert.equal(page.status,200);assert.match(await page.text(),/Print schedule/);
 const response=await call('/api/workspace/schedule-print?date=2026-11-12&view=day',owner);assert.equal(response.status,200);const data=await response.json();assert.equal(data.start,'2026-11-12');assert.equal(data.end,'2026-11-12');assert.doesNotMatch(JSON.stringify(data),/PRIVATE|LEGACY UNPUBLISHED/);
 assert.ok([401,403].includes((await call('/api/workspace/schedule-print?date=2026-11-12',employee)).status));assert.equal((await call('/schedule/print?date=2026-11-12',employee)).status,200);
});
