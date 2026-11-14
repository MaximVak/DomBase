import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("publication choices, personal alerts and email delivery stay private and atomic", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/s07-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, { recursive: true, force: true }); } });
  await runLocalDb("migrate", [], statePath);
  const s = await loadServerModule("db/schema.ts");
  const { createAuthService, createAccessService, createWorkforceService, createSelfService, newToken, saveBody } = await loadServerModule("tests/support/workforce-runtime.ts");
  const { getPlatformProxy } = await import("wrangler");
  platform = await getPlatformProxy({ configPath, persist: { path: join(statePath, "v3") }, remoteBindings: false, envFiles: [] });
  const db = drizzle(platform.env.DB, { schema: s }), secret = "isolated-shift-builder-test-secret-at-least-32-characters";
  const auth = createAuthService(db, { secret }), access = createAccessService(db, auth);
  const workspace = createWorkforceService(db, access, { secret, fieldKey, emailEnabled: true });
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
  const self=createSelfService(db,auth,secret), selfCall=(action,body,cookie=employee)=>self.handle(request('/api/self/'+action,cookie,body));
  const {dispatchScheduleEmails,scheduleEmailMessage}=await loadServerModule('workforce/schedule-email.ts');
  const period={start:'2026-11-09',end:'2026-11-15'},all={departmentId:null,period,notify:'changed',inApp:true,email:true};
  const preview=async(options=all,cookie=owner)=>{const v=await snapshot(cookie);return call('publish-preview',cookie,{revision:v.revision,options});};
  const apply=async(p,options=all,cookie=owner,key=f.b.id,extra={})=>{const v=await snapshot(cookie);return call('commit',cookie,saveBody(v,[{entity:'schedule-publish',id:1,before:v.state.scheduleDraftsByManager[key],after:{publish:true,...options,reviewToken:p.reviewToken,...extra}}],newToken()));};
  const shift=(id,person=f.a,role=f.roleA,date='2026-11-09')=>({id,employeeId:person.id,date,start:'09:00',end:'12:00',role:role.name,station:'Floor',notes:'',shiftType:'work',color:'blue'});
  const pending=()=>db.select().from(s.scheduleEmails).where(sql`state='pending'`);
  const sent=[],emailEnv={INVITATION_EMAIL_FROM:'sender@example.test',INVITATION_EMAIL_REPLY_TO:'reply@example.test',INVITATION_EMAIL_ORIGIN:'https://schedule.example.test',INVITATION_EMAIL:{send:async message=>{sent.push(message);return{messageId:'accepted-fixture'};}}};
  await t.test('signed department publication keeps unrelated weeks/departments and never exposes email addresses',async()=>{
    await ok(await draft([shift(97001),shift(97002,f.b,f.roleB),shift(97003,f.a,f.roleA,'2026-11-16')]));
    const options={...all,departmentId:f.deptA.id},p=await ok(await preview(options));assert.equal(p.changes,1);assert.equal(p.remaining,2);assert.equal(p.emailDestinations,1);assert.equal(p.recipients[0].employeeId,f.a.id);assert.doesNotMatch(JSON.stringify(p),/@example|Private|amountCents|ssn/i);
    assert.equal((await apply(p,{...options,notify:'all'})).status,409);await ok(await apply(p,options));
    const v=await snapshot();assert.equal(v.state.shifts.filter(row=>row.id===97001).length,1);assert.deepEqual(v.state.scheduleDraftsByManager[f.b.id].upsertedShifts.map(row=>row.id),[97002,97003]);assert.equal((await pending()).length,1);
    const feed=await ok(await selfCall('schedule-alerts'));assert.equal(feed.notices.length,1);assert.equal(feed.notices[0].weekStart,period.start);assert.doesNotMatch(JSON.stringify(feed),/@example|Other department|notes|wage|ssn/i);
  });
  await t.test('employee receipts are own-only, idempotent, and do not stale workforce edits',async()=>{
    const feed=await ok(await selfCall('schedule-alerts')),notice=feed.notices[0],before=(await snapshot()).revision;
    const body={notificationId:notice.id,contextToken:feed.contextToken,action:'read'};await ok(await selfCall('schedule-alerts',body));await ok(await selfCall('schedule-alerts',body));assert.equal((await snapshot()).revision,before);assert.equal((await ok(await selfCall('schedule-alerts'))).notices[0].opened,true);
    assert.equal((await selfCall('schedule-alerts',{...body,notificationId:'manager-notice'})).status,404);assert.equal((await selfCall('schedule-alerts',{...body,contextToken:'wrong'})).status,409);assert.equal((await selfCall('schedule-alerts?employeeId='+f.b.id)).status,400);
    await ok(await selfCall('schedule-alerts',{...body,action:'dismiss'}));assert.equal((await ok(await selfCall('schedule-alerts'))).notices.length,0);
  });
  await t.test('two concurrent dispatchers send once; provider acceptance is retained across cron runs',async()=>{
    await Promise.all([dispatchScheduleEmails(db,emailEnv),dispatchScheduleEmails(db,emailEnv)]);assert.equal(sent.length,1);await dispatchScheduleEmails(db,emailEnv);assert.equal(sent.length,1);const rows=await db.select().from(s.scheduleEmails);assert.equal(rows[0].state,'accepted');assert.equal(rows[0].leaseToken,null);assert.match(sent[0].text,/https:\/\/schedule.example.test\/me\/schedule/);assert.doesNotMatch(sent[0].text,/Local department|09:00|notes|wage/i);
    const p=await ok(await preview({...all,email:false}));assert.equal(p.latest.emails.accepted,1);assert.doesNotMatch(JSON.stringify(p.latest),/@example/);
  });
  await t.test('nobody publication makes no notices and keeps later draft dates',async()=>{
    const count=(await db.select().from(s.notifications)).length,options={...all,notify:'none'},p=await ok(await preview(options));assert.equal(p.changes,1);assert.equal(p.recipients.length,0);await ok(await apply(p,options));assert.equal((await db.select().from(s.notifications)).length,count);assert.equal((await pending()).length,0);assert.deepEqual((await snapshot()).state.scheduleDraftsByManager[f.b.id].upsertedShifts.map(row=>row.id),[97003]);await ok(await publish());await dispatchScheduleEmails(db,emailEnv);
  });
  await t.test('reassignment alerts both old and new assignee, deletion alerts former assignee, unchanged edits do not alert',async()=>{
    const original=(await snapshot()).state.shifts.find(row=>row.id===97001);await ok(await draft([{...original,employeeId:f.multi.id}]));let p=await ok(await preview());assert.deepEqual(p.recipients.map(row=>row.employeeId).sort(),[f.a.id,f.multi.id].sort());await ok(await apply(p));await dispatchScheduleEmails(db,emailEnv);
    const current=(await snapshot()).state.shifts.find(row=>row.id===97001);await ok(await draft([current]));p=await ok(await preview());assert.equal(p.recipients.length,0);await ok(await apply(p));
    await ok(await draft([], [97001]));p=await ok(await preview());assert.deepEqual(p.recipients.map(row=>row.employeeId),[f.multi.id]);await ok(await apply(p));await dispatchScheduleEmails(db,emailEnv);
  });
  await t.test('personal channel preferences use context/revision/version CAS and idempotent saves',async()=>{
    const p=await ok(await selfCall('schedule-preferences'));assert.equal(p.version,0);assert.equal(p.inApp,true);assert.equal(p.email,true);assert.equal(p.hasEmail,true);assert.doesNotMatch(JSON.stringify(p),/@example/);
    const body={id:newToken(),contextToken:p.contextToken,revision:p.revision,version:p.version,inApp:false,email:false};await ok(await selfCall('schedule-preferences',body));await ok(await selfCall('schedule-preferences',body));assert.equal((await selfCall('schedule-preferences',{...body,id:newToken()})).status,409);assert.equal((await selfCall('schedule-preferences',{...body,id:newToken(),employeeId:f.b.id})).status,400);
    const req=request('/api/self/schedule-preferences',employee,body);req.headers.set('Origin','https://evil.example.test');assert.equal((await self.handle(req)).status,403);assert.equal((await selfCall('schedule-preferences',undefined,owner)).status,403);
    const next=await ok(await selfCall('schedule-preferences'));assert.equal(next.version,1);assert.equal(next.email,false);
  });
  await t.test('all notifies active scoped employees and respects per-channel opt-outs, location and company controls',async()=>{
    await db.insert(s.employeeSettings).values({employeeId:f.multi.id,sendLocationAlerts:false});await ok(await draft([shift(97010)]));const options={...all,departmentId:f.deptA.id,notify:'all'},p=await ok(await preview(options));assert.deepEqual(p.recipients.map(row=>row.employeeId),[f.managerEmployee.id]);assert.ok(p.optedOut>=2);await ok(await apply(p,options));await dispatchScheduleEmails(db,emailEnv);
    await db.update(s.locationSettings).set({notifyScheduleChanges:false});await ok(await draft([shift(97011,f.a,f.roleA,'2026-11-10')]));const off=await ok(await preview());assert.equal(off.masterEnabled,false);assert.equal(off.recipients.length,0);await ok(await apply(off));await db.update(s.locationSettings).set({notifyScheduleChanges:true});
    await db.update(s.employeeSettings).set({sendLocationAlerts:true}).where(sql`employee_id=${f.multi.id}`);const pref=await ok(await selfCall('schedule-preferences'));await ok(await selfCall('schedule-preferences',{id:newToken(),contextToken:pref.contextToken,revision:pref.revision,version:pref.version,inApp:true,email:true}));
  });
  await t.test('shared addresses deduplicate email while preserving individual in-app receipts; missing addresses are explicit',async()=>{
    await db.update(s.employees).set({email:'SHARED@example.test'}).where(sql`id=${f.a.id}`);await db.update(s.employees).set({email:' shared@example.test '}).where(sql`id=${f.multi.id}`);await db.update(s.employees).set({email:''}).where(sql`id=${f.managerEmployee.id}`);
    await ok(await draft([shift(97012,f.a,f.roleA,'2026-11-11')]));const options={...all,notify:'all',departmentId:f.deptA.id},p=await ok(await preview(options));assert.equal(p.emailDestinations,1);assert.equal(p.missingEmail,1);assert.equal(p.recipients.length,3);await ok(await apply(p,options));assert.equal((await pending()).length,1);await dispatchScheduleEmails(db,emailEnv);const status=await ok(await preview(options));assert.equal(status.latest.inAppCount,3);assert.equal(status.latest.recipients.filter(row=>row.email==='accepted').length,2);
  });
  await t.test('pending deliveries cancel when current address or preferences change; missing configuration does not consume queue',async()=>{
    await ok(await draft([shift(97013,f.a,f.roleA,'2026-11-12')]));let p=await ok(await preview());await ok(await apply(p));await dispatchScheduleEmails(db,{});assert.equal((await pending()).length,1);await db.update(s.employees).set({email:'changed@example.test'}).where(sql`id=${f.a.id}`);const count=sent.length;await dispatchScheduleEmails(db,emailEnv);assert.equal(sent.length,count);assert.equal((await pending()).length,0);
    await ok(await draft([shift(97014,f.a,f.roleA,'2026-11-13')]));p=await ok(await preview());await ok(await apply(p));await db.update(s.scheduleNotificationPreferences).set({email:false}).where(sql`employee_id=${f.a.id}`);await dispatchScheduleEmails(db,emailEnv);assert.equal(sent.length,count);await db.update(s.scheduleNotificationPreferences).set({email:true}).where(sql`employee_id=${f.a.id}`);
  });
  await t.test('provider failure and expired leases become uncertain without automatic resend',async()=>{
    await ok(await draft([shift(97015,f.a,f.roleA,'2026-11-14')]));let p=await ok(await preview());await ok(await apply(p));let calls=0;const failed={...emailEnv,INVITATION_EMAIL:{send:async()=>{calls++;throw new Error('private provider address');}}};await dispatchScheduleEmails(db,failed);await dispatchScheduleEmails(db,failed);assert.equal(calls,1);assert.equal((await db.select().from(s.scheduleEmails).where(sql`state='uncertain'`)).length,1);
    await ok(await draft([shift(97016,f.a,f.roleA,'2026-11-15')]));p=await ok(await preview());await ok(await apply(p));await db.run(sql`UPDATE schedule_emails SET state='sending',lease_until='2000-01-01T00:00:00Z',lease_token='expired' WHERE state='pending'`);const count=sent.length;await dispatchScheduleEmails(db,emailEnv);assert.equal(sent.length,count);assert.equal((await db.select().from(s.scheduleEmails).where(sql`state='uncertain'`)).length,2);
    assert.doesNotMatch(JSON.stringify(scheduleEmailMessage('https://schedule.example.test',123)),/@example|private provider/);
  });
  await t.test('publication and alert outbox roll back together on audit failure',async()=>{
    await ok(await draft([{...shift(97017,f.a,f.roleA,'2026-11-10'),start:'13:00',end:'14:00'}]));const p=await ok(await preview()),before=await snapshot(),publications=await db.select().from(s.schedulePublications),mails=await db.select().from(s.scheduleEmails),notices=await db.select().from(s.notifications);
    await db.run(sql`CREATE TRIGGER fail_s07 BEFORE INSERT ON audit_log WHEN NEW.action='workforce.changed' BEGIN SELECT RAISE(ABORT,'fixture'); END`);assert.equal((await apply(p)).status,503);assert.equal((await snapshot()).revision,before.revision);assert.deepEqual(await db.select().from(s.schedulePublications),publications);assert.deepEqual(await db.select().from(s.scheduleEmails),mails);assert.deepEqual(await db.select().from(s.notifications),notices);await db.run(sql`DROP TRIGGER fail_s07`);
    const responses=await Promise.all([apply(p),apply(p)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);await dispatchScheduleEmails(db,emailEnv);
  });
  await t.test('clear week offers atomic template preservation, keeps other work, and publishes removals separately',async()=>{
    await ok(await draft([shift(97020,f.a,f.roleA,'2026-12-01')]));const v=await snapshot(),options={weekStart:period.start,selection:{departmentId:f.deptA.id,roleId:null,employeeIds:null},templateName:'Before fictional clear',includeNotes:true};
    const clear=await ok(await call('schedule-tools',owner,{action:'clear-preview',revision:v.revision,...options}));assert.ok(clear.cleared>=5);assert.equal(clear.templateEntries,clear.cleared);assert.equal((await snapshot()).revision,v.revision);assert.equal((await call('schedule-tools',owner,{action:'clear',id:newToken(),revision:v.revision,...options,reviewToken:'forged'})).status,409);
    await ok(await call('schedule-tools',owner,{action:'clear',id:newToken(),revision:v.revision,...options,reviewToken:clear.reviewToken}));const current=await snapshot();assert.equal(current.state.shifts.filter(row=>row.date>=period.start&&row.date<=period.end&&row.role===f.roleA.name).length,clear.cleared);assert.equal(current.state.scheduleDraftsByManager[f.b.id].upsertedShifts[0].id,97020);assert.equal((await db.select().from(s.scheduleTemplateEntries)).length,clear.cleared);
    const pubOptions={...all,departmentId:f.deptA.id,email:false},p=await ok(await preview(pubOptions));await ok(await apply(p,pubOptions));assert.ok((await snapshot()).state.shifts.some(row=>row.id===97002));assert.equal((await snapshot()).state.scheduleDraftsByManager[f.b.id].upsertedShifts[0].id,97020);
  });
  await t.test('another publication requires a fresh signed review and explicit latest-schedule acknowledgement',async()=>{
    await ok(await draft([shift(97030,f.a,f.roleA,'2027-01-05')],[],manager,f.managerEmployee.id));
    await ok(await publish());
    const options={...all,period:{start:'2027-01-04',end:'2027-01-10'},email:false},p=await ok(await preview(options,manager));assert.equal(p.needsReview,true);assert.equal((await apply(p,options,manager,f.managerEmployee.id)).status,409);
    await ok(await apply(p,options,manager,f.managerEmployee.id,{reviewLatest:true}));assert.ok((await snapshot()).state.shifts.some(row=>row.id===97030));
  });
  await t.test('clear-without-template is explicit and audit failure preserves both template and draft',async()=>{
    const options={weekStart:'2027-01-04',selection:{departmentId:f.deptA.id,roleId:null,employeeIds:null},templateName:'Rollback clearing',includeNotes:false},before=await snapshot(),templates=await db.select().from(s.scheduleTemplates);
    const p=await ok(await call('schedule-tools',owner,{action:'clear-preview',revision:before.revision,...options}));
    await db.run(sql`CREATE TRIGGER fail_s07_clear BEFORE INSERT ON audit_log WHEN NEW.action='workforce.changed' BEGIN SELECT RAISE(ABORT,'fixture'); END`);assert.equal((await call('schedule-tools',owner,{action:'clear',id:newToken(),revision:p.revision,...options,reviewToken:p.reviewToken})).status,503);assert.equal((await snapshot()).revision,before.revision);assert.deepEqual(await db.select().from(s.scheduleTemplates),templates);assert.equal((await db.select().from(s.scheduleDrafts)).length,0);await db.run(sql`DROP TRIGGER fail_s07_clear`);
    options.templateName=null;const skip=await ok(await call('schedule-tools',owner,{action:'clear-preview',revision:before.revision,...options}));assert.equal(skip.templateEntries,0);await ok(await call('schedule-tools',owner,{action:'clear',id:newToken(),revision:skip.revision,...options,reviewToken:skip.reviewToken}));assert.deepEqual(await db.select().from(s.scheduleTemplates),templates);
    const latest=await snapshot();await ok(await call('commit',owner,saveBody(latest,[{entity:'schedule-draft',id:1,before:latest.state.scheduleDraftsByManager[f.b.id],after:null}],newToken())));
  });
  await t.test('scope, method, disabled mail configuration and live captured-context revocation fail closed',async()=>{
    assert.equal((await call('publish-preview',employee,{revision:(await snapshot()).revision,options:all})).status,401);assert.equal((await call('publish-preview')).status,405);assert.equal((await preview({...all,departmentId:f.deptB.id},manager)).status,403);
    const unconfigured=createWorkforceService(db,access,{secret,fieldKey}),v=await snapshot();assert.equal((await unconfigured.handle(request('/api/workspace/publish-preview',owner,{revision:v.revision,options:all}))).status,400);
    const captured=await access.workspaceContext(request('/api/workspace/state',manager));await f.disableManager();const revoked=createWorkforceService(db,{workspaceContext:async()=>captured},{secret,fieldKey,emailEnabled:true});assert.equal((await revoked.handle(request('/api/workspace/publish-preview',manager,{revision:v.revision,options:all}))).status,401);assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`),[]);
  });
});
