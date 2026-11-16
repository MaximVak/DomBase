import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {startAuthApp} from './support/auth-app-fixture.mjs';
import {seedWorkforceFixture} from './support/workforce-fixture.mjs';
import {loadServerModule} from '../scripts/server-runtime.mjs';

test('built Worker completes cover and trade with private employee consent, manager approval and published schedule updates',{timeout:120000},async t=>{
 const{offsetScheduleDate}=await loadServerModule('self/schedule-model.ts');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),date=offsetScheduleDate(today,14);
 const app=await startAuthApp({seed:async(db,s,load,password)=>{
  const f=await seedWorkforceFixture(db,s,load,password),{hashPassword}=await load('auth/crypto.ts');
  const[second]=await db.insert(s.accounts).values({employeeId:f.multi.id,email:'exchange-http@example.test',normalizedEmail:'exchange-http@example.test',displayName:'Fictional exchange recipient',accessLevel:'employee',passwordHash:await hashPassword(password),loginEnabled:true}).returning();
  await db.update(s.employees).set({email:''}).where(eq(s.employees.id,f.a.id));await db.update(s.employees).set({email:''}).where(eq(s.employees.id,f.multi.id));await db.update(s.locationSettings).set({employeesOwnScheduleOnly:true});
  const[pub]=await db.insert(s.schedulePublications).values({version:1,publishedByAccountId:f.owner.id}).returning();
  const rows=await db.insert(s.shifts).values([{employeeId:f.a.id,date,startTime:'22:00',endTime:'06:00'},{employeeId:f.a.id,date:offsetScheduleDate(date,1),startTime:'09:00',endTime:'12:00'},{employeeId:f.multi.id,date:offsetScheduleDate(date,2),startTime:'22:00',endTime:'06:00'}].map(row=>({...row,roleId:f.roleA.id,roleName:f.roleA.name,publicationId:pub.id,notes:'Private retained exchange note',station:'Counter',color:'amber'}))).returning();return{...f,second,rows};
 }});t.after(app.close);
 const id=()=>randomBytes(32).toString('base64url');
 const call=(path,cookie='',body)=>fetch(app.origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Cookie:cookie,Connection:'close',...body===undefined?{}:{Origin:app.origin,'Content-Type':'application/json'}},...body===undefined?{}:{method:'POST',body:JSON.stringify(body)}}).then(async r=>new Response(await r.arrayBuffer(),{status:r.status,headers:r.headers}));
 const ok=async r=>{const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));assert.equal(r.headers.get('X-Schedule-Dispatch'),null);return b;};
 const login=async account=>{const r=await call('/api/auth/login','',{email:account.email,password:app.password});await ok(r);return r.headers.get('set-cookie').split(';')[0];};
 const f=app.fixtureData,employee=await login(f.employeeAccount),second=await login(f.second),manager=await login(f.manager);
 const feed=cookie=>call('/api/self/shift-exchanges',cookie).then(ok);
 const schedule=(cookie,day=date)=>call('/api/self/schedule?date='+day,cookie).then(ok);
 for(const [index,kind]of ['cover','trade'].entries()){
  const source=f.rows[index],catalog=await ok(await call(`/api/self/shift-exchanges?sourceShiftId=${source.id}&kind=${kind}`,employee));assert.deepEqual(catalog.people.map(p=>p.id),[f.multi.id]);assert.doesNotMatch(JSON.stringify(catalog),/Private|notes|wages|example|phone/);
  await ok(await call('/api/self/shift-exchanges',employee,{id:id(),contextToken:catalog.contextToken,revision:catalog.revision,action:'create',kind,sourceShiftId:source.id,recipientIds:[f.multi.id]}));
  let incoming=await feed(second),parent=incoming.requests.find(row=>row.source.id===source.id);assert.equal(parent.status,'pending');let offer=null;
  if(kind==='trade'){const choices=await ok(await call(`/api/self/shift-exchanges?requestId=${parent.id}&date=${f.rows[2].date}`,second));assert.ok(choices.shifts.some(r=>r.id===f.rows[2].id&&r.canOffer));offer=f.rows[2].id;}
  await ok(await call('/api/self/shift-exchanges',second,{id:id(),contextToken:incoming.contextToken,revision:incoming.revision,action:'accept',requestId:parent.id,version:parent.version,...offer?{offeredShiftId:offer}:{}}));assert.ok((await schedule(employee,source.date)).shifts.some(row=>row.id===source.id&&row.employeeId===f.a.id));
  const waiting=await ok(await call('/api/workspace/shift-exchanges',manager));parent=waiting.requests.find(row=>row.id===parent.id);assert.equal(parent.status,'accepted');const decision={revision:waiting.revision,requestId:parent.id,decision:'approve',reason:''},review=await ok(await call('/api/workspace/shift-exchanges',manager,{action:'decision-preview',...decision}));await ok(await call('/api/workspace/shift-exchanges',manager,{action:'decide',id:id(),...decision,reviewToken:review.reviewToken}));
  assert.equal((await feed(employee)).requests.find(row=>row.id===parent.id).status,'approved');assert.ok((await schedule(second,source.date)).shifts.some(row=>row.id===source.id&&row.employeeId===f.multi.id));const reassigned=(await schedule(second,source.date)).shifts.find(row=>row.id===source.id);assert.equal(reassigned.start,source.startTime);assert.equal(reassigned.end,source.endTime);assert.ok(!(await schedule(employee,source.date)).shifts.some(row=>row.id===source.id));if(offer)assert.ok((await schedule(employee,f.rows[2].date)).shifts.some(row=>row.id===offer&&row.employeeId===f.a.id));
 }
 const page=await call('/me/schedule',employee);assert.equal(page.status,200);assert.match(await page.text(),/Trades &amp; cover requests|Trades & cover requests|shift requests/);
 assert.equal((await call('/api/self/shift-exchanges?employeeId='+f.b.id,employee)).status,400);assert.equal((await call('/api/workspace/shift-exchanges',employee)).status,401);assert.equal((await call('/api/self/shift-exchanges',manager)).status,403);
});
