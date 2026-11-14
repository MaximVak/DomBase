import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("schedule tools preserve scoped drafts, reusable templates and publication", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/s06-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const s = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createWorkforceService, newToken, saveBody } = await loadServerModule("tests/support/workforce-runtime.ts");
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const db = drizzle(platform.env.DB, { schema: s }), secret = "isolated-shift-builder-test-secret-at-least-32-characters";
  const auth = createAuthService(db, { secret }), access = createAccessService(db, auth);
  const workspace = createWorkforceService(db, access, { secret, fieldKey });
  const password = "Fictional shift builder test passphrase!";
  const f = await seedWorkforceFixture(db, s, loadServerModule, password), origin = "http://localhost:3000";
  const request = (path, cookie = "", body) => new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = async response => { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
  const login = async account => { const r = await auth.handle(request("/api/auth/login", "", { email: account.email, password })); await ok(r); return r.headers.get("set-cookie").split(";")[0]; };
  const owner = await login(f.owner), manager = await login(f.manager), employee = await login(f.employeeAccount);
  const call = (action, cookie = owner, body) => workspace.handle(request("/api/workspace/" + action, cookie, body));
  const snapshot = (cookie = owner) => call("state?start=2026-10-01&end=2027-03-01", cookie).then(ok);
  const draft = async (upserts, deleted = [], cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-draft", id: 1, before: view.state.scheduleDraftsByManager[key] ?? null,
      after: { upsertedShifts: upserts, deletedShiftIds: deleted, affectedEmployeeIds: upserts.map(s => s.employeeId) } }], newToken()));
  };
  const publish = async (cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[key], after: { publish: true } }], newToken()));
  };
  const all={departmentId:null,roleId:null,employeeIds:null},period={start:'2026-11-09',end:'2026-11-15'};
  const tool=(cookie,body)=>call('schedule-tools',cookie,body);
  const current=(cookie=owner)=>snapshot(cookie);
  async function command(action,fields={},cookie=owner){const v=await current(cookie);return tool(cookie,{action,id:newToken(),revision:v.revision,...fields});}
  async function preview(fields={},cookie=owner){const v=await current(cookie);return tool(cookie,{action:'preview',revision:v.revision,source:{kind:'week',weekStart:'2026-11-09'},targets:['2026-11-16'],selection:all,mode:'add',includeNotes:false,...fields});}
  async function applied(p,fields={},cookie=owner){return tool(cookie,{action:'apply',id:newToken(),revision:p.revision,source:{kind:'week',weekStart:'2026-11-09'},targets:p.targets,selection:all,mode:'add',includeNotes:false,reviewToken:p.reviewToken,...fields});}
  const seed=[{id:91001,employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,date:'2026-11-09',startTime:'09:15',endTime:'12:30',notes:'Private source note',color:'amber'}, {id:91002,employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,date:'2026-11-09',startTime:'13:00',endTime:'17:00',color:'violet'}, {id:91003,employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,date:'2026-11-10',startTime:'00:00',endTime:'00:00',shiftType:'day_off',color:'gray'}, {id:91004,employeeId:f.b.id,roleId:f.roleB.id,roleName:f.roleB.name,date:'2026-11-09',startTime:'08:00',endTime:'16:00',notes:'Other department secret'}];
  for(const row of seed)await db.insert(s.shifts).values(row);
  const [ar]=await db.insert(s.availabilityRequests).values({employeeId:f.a.id,effectiveDate:'2026-11-01',status:'approved'}).returning();await db.insert(s.availabilitySlots).values({requestId:ar.id,dayOfWeek:1,startMinute:600,endMinute:660,preference:'unavailable'});
  await db.insert(s.ptoRequests).values({employeeId:f.a.id,compensation:'unpaid',reason:'vacation',explanation:'Private leave explanation',status:'approved',startDate:'2026-11-16',endDate:'2026-11-16'});
  let templateId;
  await t.test('templates snapshot weekly draft attributes, shared visibility, rename, archival, restore and exact revision guards',async()=>{
    const selection={...all,departmentId:f.deptA.id};
    const view=await current(),originalShifts=await db.select().from(s.shifts);
    const response=await command('save-template',{name:'Fictional split week',weekStart:period.start,selection,includeNotes:true});const result=await ok(response);templateId=result.templateId;
    const rows=await db.select().from(s.scheduleTemplateEntries).where(sql`template_id=${templateId}`);assert.equal(rows.length,3);assert.equal(rows[0].startTime,'09:15');assert.equal(rows[0].notes,'Private source note');assert.equal(rows[2].shiftType,'day_off');assert.deepEqual(await db.select().from(s.shifts),originalShifts);
    const list=await ok(await tool(manager,{action:'list',archived:false}));assert.ok(list.templates.some(t=>t.id===templateId&&t.entries===3));assert.ok(!JSON.stringify(list).includes('Private'));
    const hidden=await ok(await command('save-template',{name:'Other scope template',weekStart:period.start,selection:all,includeNotes:true}));assert.ok(!(await ok(await tool(manager,{action:'list',archived:false}))).templates.some(t=>t.id===hidden.templateId));assert.equal((await preview({source:{kind:'template',id:hidden.templateId}},manager)).status,404);
    assert.equal((await tool(owner,{action:'rename-template',id:newToken(),revision:view.revision,templateId,name:'Stale name'})).status,409);
    await ok(await command('rename-template',{templateId,name:'Renamed split week'}));await ok(await command('archive-template',{templateId,archived:true}));assert.ok(!(await ok(await tool(owner,{action:'list',archived:false}))).templates.some(t=>t.id===templateId));assert.ok((await ok(await tool(owner,{action:'list',archived:true}))).templates.some(t=>t.id===templateId));assert.equal((await preview({source:{kind:'template',id:templateId}})).status,409);await ok(await command('archive-template',{templateId,archived:false}));
    assert.equal((await db.select().from(s.scheduleTemplateEntries).where(sql`template_id=${templateId}`)).length,3);
  });
  await t.test('template apply previews warnings read-only, saves an isolated draft, replays idempotently and publishes separately',async()=>{
    const before=await current(),audits=await db.select().from(s.auditLog),published=await db.select().from(s.shifts);
    const p=await ok(await preview({source:{kind:'template',id:templateId},includeNotes:true}));assert.equal(p.added,3);assert.equal(p.issues.length,0);assert.ok(p.warnings.warnings.some(w=>w.codes.includes('unavailable')&&w.codes.includes('time_off')));assert.deepEqual(await db.select().from(s.auditLog),audits);assert.deepEqual(await db.select().from(s.shifts),published);assert.equal((await current()).revision,before.revision);
    const body={action:'apply',id:newToken(),revision:p.revision,source:{kind:'template',id:templateId},targets:p.targets,selection:all,mode:'add',includeNotes:true,reviewToken:p.reviewToken};assert.equal((await tool(owner,{...body,targets:['2026-11-23']})).status,409);await ok(await tool(owner,body));await ok(await tool(owner,body));assert.equal((await current()).state.scheduleDraftsByManager[f.b.id].upsertedShifts.length,3);assert.deepEqual(await db.select().from(s.shifts),published);
    await ok(await publish());const after=await current();const copied=after.state.shifts.filter(row=>row.date==='2026-11-16'&&row.employeeId===f.a.id);assert.equal(copied.length,2);assert.equal(copied.find(row=>row.start==='09:15').notes,'Private source note');assert.equal(copied.find(row=>row.start==='09:15').color,'amber');assert.ok(after.state.shifts.some(row=>row.date==='2026-11-17'&&row.shiftType==='day_off'));
    assert.ok(!(await db.select().from(s.scheduleDrafts)).length);
  });
  await t.test('add blocks existing overlap; scoped replacement keeps other departments and unrelated draft entries',async()=>{
    const p=await ok(await preview());assert.ok(p.issues.some(issue=>/overlap|day off/.test(issue)));assert.equal((await applied(p)).status,409);
    const unrelated={id:92001,employeeId:f.a.id,date:'2026-12-10',start:'10:00',end:'12:00',role:f.roleA.name,station:'Floor',notes:'',color:'green',shiftType:'work'};await ok(await draft([unrelated]));
    const selection={...all,employeeIds:[f.a.id]},replace=await ok(await preview({selection,mode:'replace'}));assert.equal(replace.added,3);assert.equal(replace.replaced,3);assert.equal(replace.issues.length,0);await ok(await applied(replace,{selection,mode:'replace'}));const v=await current();assert.ok(v.state.scheduleDraftsByManager[f.b.id].upsertedShifts.some(row=>row.id===unrelated.id));await ok(await publish());assert.ok((await current()).state.shifts.some(row=>row.id===unrelated.id));
  });
  await t.test('permission, selector, CSRF, notes, bounds and signed-review safeguards reject forged requests',async()=>{
    assert.equal((await tool(employee,{action:'list',archived:false})).status,401);assert.equal((await call('schedule-tools',owner)).status,405);
    assert.equal((await tool(owner,{action:'list',archived:false,employeeId:f.b.id})).status,400);
    const v=await current(),choice={action:'preview',revision:v.revision,source:{kind:'week',weekStart:period.start},targets:['2026-12-14'],selection:all,mode:'add',includeNotes:false};
    const csrf=request('/api/workspace/schedule-tools',owner,choice);csrf.headers.set('Origin','https://untrusted.example.test');assert.equal((await workspace.handle(csrf)).status,403);
    assert.equal((await tool(owner,{...choice,targets:['2026-11-09']})).status,400);assert.equal((await tool(owner,{...choice,source:{kind:'week',weekStart:'2026-11-10'}})).status,400);assert.equal((await tool(owner,{...choice,targets:['2026-11-16','2026-11-23','2026-11-30','2026-12-07','2026-12-14']})).status,400);
    assert.equal((await tool(owner,{...choice,action:'apply',id:newToken(),reviewToken:'forged'})).status,409);
    assert.equal((await preview({selection:{...all,departmentId:f.deptB.id}},manager)).status,403);
    await db.insert(s.accountPermissions).values([{accountId:f.manager.id,permission:'schedule.notes.read',allowed:false},{accountId:f.manager.id,permission:'schedule.notes.manage',allowed:false}]).onConflictDoUpdate({target:[s.accountPermissions.accountId,s.accountPermissions.permission],set:{allowed:false}});
    assert.equal((await preview({targets:['2026-12-14'],includeNotes:true},manager)).status,403);const p=await ok(await preview({targets:['2026-12-14']},manager));assert.doesNotMatch(JSON.stringify(p),/Private source note|Other department secret|amountCents|wageRates|Private leave/);
    await db.insert(s.accountPermissions).values({accountId:f.manager.id,permission:'schedule.manage',allowed:false});assert.equal((await tool(manager,{action:'list',archived:false})).status,403);
  });
  await t.test('four full weeks are copied, warned, published and later edited without per-row D1 limits',async()=>{
    const people=[];for(let i=0;i<10;i++){const[e]=await db.insert(s.employees).values({name:`Repeat fictional ${i}`,pinHash:`unenrolled:repeat${i}`,roleId:f.roleA.id,active:true,startDate:'2026-01-01'}).returning();people.push(e.id);await db.insert(s.employeeRoles).values({employeeId:e.id,roleId:f.roleA.id});for(let d=0;d<5;d++)await db.insert(s.shifts).values({employeeId:e.id,roleId:f.roleA.id,roleName:f.roleA.name,date:`2026-11-${String(9+d).padStart(2,'0')}`,startTime:'09:00',endTime:'17:00',notes:'Repeat fixture note',color:'green'});}
    const selection={...all,employeeIds:people},targets=['2026-12-14','2026-12-21','2026-12-28','2027-01-04'];const p=await ok(await preview({selection,targets,includeNotes:true}));assert.equal(p.added,200);assert.equal(p.issues.length,0);assert.equal(p.warnings.warnings.length,200);await ok(await applied(p,{selection,includeNotes:true}));assert.equal((await current()).state.scheduleDraftsByManager[f.b.id].upsertedShifts.length,200);await ok(await publish());let v=await current();assert.equal(v.state.shifts.filter(row=>targets.some(week=>row.date>=week&&row.date<=new Date(Date.parse(week+'T12:00:00Z')+6*86400000).toISOString().slice(0,10))&&people.includes(row.employeeId)).length,200);
    const copied=v.state.shifts.filter(row=>people.includes(row.employeeId)&&row.date==='2026-12-14');await ok(await draft(copied.map(row=>({...row,start:'08:30'}))));await ok(await publish());v=await current();assert.ok(v.state.shifts.filter(row=>copied.some(old=>old.id===row.id)).every(row=>row.start==='08:30'));assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`),[]);
  });
  await t.test('updating a template captures this manager’s source draft without publishing or changing its original shifts',async()=>{
    const v=await current(),original=v.state.shifts.find(row=>row.id===91001),selection={...all,employeeIds:[f.a.id]};await ok(await draft([{...original,start:'09:30',notes:'Updated template note'}]));
    await ok(await command('save-template',{templateId,name:'Updated from draft',weekStart:period.start,selection,includeNotes:true}));const rows=await db.select().from(s.scheduleTemplateEntries).where(sql`template_id=${templateId}`);assert.ok(rows.some(row=>row.startTime==='09:30'&&row.notes==='Updated template note'));assert.equal((await current()).state.shifts.find(row=>row.id===91001).start,'09:15');
    const latest=await current();await ok(await call('commit',owner,saveBody(latest,[{entity:'schedule-draft',id:1,before:latest.state.scheduleDraftsByManager[f.b.id],after:null}],newToken())));
  });
  await t.test('hidden other-department work still blocks overlap without exposing its details, even in replace mode',async()=>{
    await db.update(s.accountPermissions).set({allowed:true}).where(sql`account_id=${f.manager.id} AND permission='schedule.manage'`);
    await db.insert(s.shifts).values({id:99001,employeeId:f.multi.id,roleId:f.roleA.id,roleName:f.roleA.name,date:'2026-11-09',startTime:'10:00',endTime:'12:00'});await db.insert(s.shifts).values({id:99002,employeeId:f.multi.id,roleId:f.roleB.id,roleName:f.roleB.name,date:'2027-03-01',startTime:'09:00',endTime:'17:00',notes:'Invisible collision note'});
    const p=await ok(await preview({targets:['2027-03-01'],selection:{...all,employeeIds:[f.multi.id]},mode:'replace'},manager));assert.ok(p.issues.some(issue=>/overlapping/.test(issue)));assert.doesNotMatch(JSON.stringify(p),/Invisible collision note|"id":99002|Job B/);
    assert.equal((await command('save-template',{templateId,name:'Cannot erase notes',weekStart:period.start,selection:all,includeNotes:false},manager)).status,403);
  });
  await t.test('inactive or unassigned template entries require review instead of silently disappearing',async()=>{
    await db.update(s.employees).set({active:false}).where(sql`id=${f.a.id}`);const p=await ok(await preview({source:{kind:'template',id:templateId},targets:['2027-02-01']}));assert.ok(p.issues.some(issue=>/active employee/.test(issue)));assert.equal(p.added,3);assert.equal((await applied(p,{source:{kind:'template',id:templateId}})).status,409);await db.update(s.employees).set({active:true}).where(sql`id=${f.a.id}`);
  });
  await t.test('template and draft audit failures roll back the revision and every copied row',async()=>{
    const before=await current(),templates=await db.select().from(s.scheduleTemplates),entries=await db.select().from(s.scheduleTemplateEntries);await db.run(sql`CREATE TRIGGER fail_s06_audit BEFORE INSERT ON audit_log WHEN NEW.action='workforce.changed' BEGIN SELECT RAISE(ABORT,'s06 audit fixture'); END`);
    assert.equal((await command('save-template',{name:'Must roll back',weekStart:period.start,selection:all,includeNotes:false})).status,503);assert.equal((await current()).revision,before.revision);assert.deepEqual(await db.select().from(s.scheduleTemplates),templates);assert.deepEqual(await db.select().from(s.scheduleTemplateEntries),entries);
    const p=await ok(await preview({targets:['2027-02-01'],selection:{...all,employeeIds:[f.a.id]}}));assert.equal((await applied(p,{selection:{...all,employeeIds:[f.a.id]}})).status,503);assert.equal((await current()).revision,before.revision);assert.equal((await db.select().from(s.scheduleDrafts)).length,0);await db.run(sql`DROP TRIGGER fail_s06_audit`);
  });  await t.test('older published shifts with legacy blank role labels copy using their assigned role IDs',async()=>{
    const p=await ok(await preview({source:{kind:'week',weekStart:'2026-10-26'},targets:['2027-01-11'],selection:{...all,employeeIds:[f.a.id]}}));assert.equal(p.added,1);assert.equal(p.issues.length,0);assert.equal(p.shifts[0].role,f.roleA.name);assert.equal(p.shifts[0].date,'2027-01-15');
  });
  await t.test('concurrent applies have one winner; revoked captured contexts cannot load or mutate tools',async()=>{
    const selection={...all,employeeIds:[f.a.id]},p=await ok(await preview({targets:['2027-02-15'],selection}));const responses=await Promise.all([applied(p,{selection}),applied(p,{selection})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const latest=await current();assert.equal(latest.state.scheduleDraftsByManager[f.b.id].upsertedShifts.length,3);await ok(await call('commit',owner,saveBody(latest,[{entity:'schedule-draft',id:1,before:latest.state.scheduleDraftsByManager[f.b.id],after:null}],newToken())));
    const captured=await access.workspaceContext(request('/api/workspace/schedule-tools',manager));await f.disableManager();const revoked=createWorkforceService(db,{workspaceContext:async()=>captured},{secret,fieldKey});assert.equal((await revoked.handle(request('/api/workspace/schedule-tools',manager,{action:'list',archived:false}))).status,401);
  });

});
