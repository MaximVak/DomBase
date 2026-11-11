import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { projectRoot, configPath, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedP2Fixture } from "./support/p2-fixture.mjs";
import { fieldKey } from "./support/workforce-fixture.mjs";

test("P2 reports and employee recognition preserve privacy, real records and transactional boundaries", { timeout: 180000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), {recursive:true}); const statePath = await mkdtemp(join(projectRoot, ".wrangler/p2-check-")); let platform;
  t.after(async () => { try { await platform?.dispose(); } finally { await rm(statePath, {recursive:true,force:true}); } });
  await runLocalDb("migrate", [], statePath); const { getPlatformProxy } = await import("wrangler");
  const s = await loadServerModule("db/schema.ts"), r = await loadServerModule("tests/support/workforce-runtime.ts");
  const secret = "Stage-one-P2-isolated-secret-at-least-32-characters", password = "Stage one P2 isolated verification passphrase!";
  const now = () => Date.parse("2026-11-05T05:00:00Z"), origin = "http://localhost:3000";
  let db, auth, access, insights, community;
  async function connect() { platform = await getPlatformProxy({ configPath, persist: {path:join(statePath,"v3")}, remoteBindings:false,envFiles:[] }); db=drizzle(platform.env.DB,{schema:s}); auth=r.createAuthService(db,{secret}); access=r.createAccessService(db,auth); insights=r.createTeamInsights(db,access,fieldKey,now); community=r.createCommunityService(db,auth,access,secret,now); }
  await connect(); const f=await seedP2Fixture(db,s,loadServerModule,password);
  const req=(path,cookie="",body,extra={})=>new Request(origin+path,{method:body===undefined?"GET":"POST",headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,"Content-Type":"application/json"}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const login=async email=>{const res=await auth.handle(req("/api/auth/login","",{email,password}));await ok(res);return res.headers.get("set-cookie").split(";")[0];};
  const owner=await login(f.owner.email), employee=await login(f.employeeAccount.email); let manager=await login(f.manager.email);
  const report=(cookie=owner)=>insights.handle(req("/api/team/insights?start=2026-11-01&end=2026-11-04",cookie)).then(ok);
  const state=(cookie=employee)=>community.handle(req("/api/community/state",cookie)).then(ok);
  async function save(path,values,cookie=employee,base) {const v=base??await state(cookie); return community.handle(req(`/api/community/${path}`,cookie,{id:r.newToken(),revision:v.revision,contextToken:v.contextToken,...values}));}
  await t.test("certifications warn at ten calendar days, reliability uses actual punches and approved leave",async()=>{
    const data=await report(); assert.equal(data.certificates.find(c=>c.title==="Safety certificate").status,"Due within 10 days");assert.equal(data.certificates.find(c=>c.title==="Lift certificate").status,"Current");
    const a=data.people.find(p=>p.id===f.a.id); assert.equal(a.eligible,3);assert.equal(a.worked,2);assert.equal(a.noShows,1);assert.equal(a.punctualityRate,50);assert.equal(a.onTimeShiftScore,33);
    assert.deepEqual(data.shifts.filter(s=>s.employeeId===f.a.id).map(s=>s.status),["On time","Late","Excused","No show"]);assert.equal(data.shifts.find(s=>s.employeeId===f.a.id).workedHours,7.5);
    assert.equal(data.milestones.find(m=>m.employeeId===f.a.id).label,"3 months");assert.equal(data.milestones.some(m=>m.kind==="birthday"),false);
    assert.doesNotMatch(JSON.stringify(data),/1990|1985|MEDICAL|Private address|000-12-3456|amountCents|9900|objectKey/);
  });
  await t.test("report grants, multi-department scope and tablet boundaries also apply to printable data",async()=>{
    const first=await report(manager);assert.equal(first.canCertificates,false);assert.equal(first.canReliability,false);assert.deepEqual(first.shifts,[]);
    const before=await ok(await access.handle(req(`/api/access/accounts/${f.manager.id}`,owner)));
    await ok(await access.handle(req(`/api/access/accounts/${f.manager.id}`,owner,{version:before.account.version,departmentIds:[f.deptA.id],permissions:{"reports.read":true,"documents.read":true}}))); manager=await login(f.manager.email);
    const data=await report(manager);assert.ok(data.canReliability);assert.ok(data.shifts.every(s=>s.role===f.roleA.name));assert.equal(data.certificates.some(c=>c.employeeId===f.b.id),false);assert.doesNotMatch(JSON.stringify(data),/Other department secret|Private medical|9900/);
    assert.equal((await insights.handle(req("/api/team/insights",employee))).status,401);assert.equal((await insights.handle(req("/api/team/insights",`dombase-kiosk-device=${f.deviceToken}; ${owner}`))).status,403);
    assert.equal((await insights.handle(req("/api/team/insights?start=2026-11-04&end=2025-01-01",owner))).status,400);
  });
  await t.test("birthday sharing is own-person, opt-in, versioned and never exposes a birth year",async()=>{
    const base=await state();assert.equal(base.preferences.shareBirthday,false);assert.ok(base.achievements.some(a=>a.id==="shifts:1"));
    await ok(await save("preferences",{version:0,shareBirthday:true},employee,base)); const updated=await state();assert.equal(updated.preferences.shareBirthday,true);
    assert.equal((await report(manager)).milestones.some(m=>m.employeeId===f.a.id&&m.kind==="birthday"),true);assert.doesNotMatch(JSON.stringify(updated),/1990|1985|Private address|ssn|passwordHash/);
    assert.equal((await save("preferences",{version:1,shareBirthday:true,employeeId:f.b.id})).status,400);
    assert.equal((await save("preferences",{version:0,shareBirthday:false},employee,base)).status,409);
    const fresh=await login(f.employeeAccount.email);assert.equal((await save("preferences",{version:1,shareBirthday:false},fresh,updated)).status,409);
    await ok(await save("preferences",{version:1,shareBirthday:false}));assert.equal((await report()).milestones.some(m=>m.kind==="birthday"),false);
  });
  await t.test("renewed certificate dates supersede old warnings while preserving every record",async()=>{
    await db.insert(s.employeeCertificates).values({employeeId:f.a.id,name:"EXPIRED certificate",expirationDate:"2027-11-03"});
    const data=await report();assert.equal(data.certificates.find(c=>c.title==="Expired certificate").status,"Superseded");assert.equal(data.certificateWarnings.some(c=>c.title==="Expired certificate"),false);assert.equal(data.certificates.filter(c=>c.title.toLowerCase()==="expired certificate").length,2);
  });
  await t.test("scoped managers can send within their department and recipients earn appreciation",async()=>{
    await ok(await save("shoutouts",{recipientId:f.a.id,category:"helpfulness",message:"Fictional manager thanks."},manager));
    assert.ok((await state()).achievements.some(a=>a.id==="appreciation:1"));
  });
  let shoutout;
  await t.test("employees can exchange private scoped shout-outs without impersonation or duplicate sends",async()=>{
    const base=await state();const body={id:r.newToken(),revision:base.revision,contextToken:base.contextToken,recipientId:f.managerEmployee.id,category:"teamwork",message:"Thanks for helping with the fictional shift."};
    const responses=await Promise.all([community.handle(req("/api/community/shoutouts",employee,body)),community.handle(req("/api/community/shoutouts",employee,body))]);assert.ok(responses.some(r=>r.status===200));assert.ok(responses.every(r=>[200,409].includes(r.status)));
    await ok(await community.handle(req("/api/community/shoutouts",employee,body)));assert.equal((await db.select().from(s.teamShoutouts).where(eq(s.teamShoutouts.id,body.id))).length,1);shoutout=body.id;
    assert.equal((await state(manager)).shoutouts.some(s=>s.id===body.id),true);assert.equal((await state()).shoutouts.find(s=>s.id===body.id).senderId,f.a.id);
    assert.equal((await save("shoutouts",{recipientId:f.a.id,category:"teamwork",message:"Self"})).status,403);
    assert.equal((await save("shoutouts",{senderId:f.b.id,recipientId:f.managerEmployee.id,category:"teamwork",message:"Forged"})).status,400);
    assert.equal((await save("shoutouts",{recipientId:f.b.id,category:"invented",message:"Bad category"})).status,400);
    assert.equal((await save("shoutouts",{recipientId:f.b.id,category:"great_work",message:"x".repeat(501)})).status,400);
    const other=await login(f.owner.email);assert.equal((await state(other)).shoutouts.length,2);
    assert.equal((await save("shoutouts",{recipientId:f.b.id,category:"great_work",message:"Cross-department"},manager)).status,403);
  });
  await t.test("moderation preserves original messages, and failures roll back data/revision/audit",async()=>{
    assert.equal((await save("moderate",{shoutoutId:shoutout})).status,403);
    await db.run(sql`CREATE TRIGGER p2_audit_fail BEFORE INSERT ON audit_log WHEN NEW.action='workforce.changed' BEGIN SELECT RAISE(ABORT,'forced rollback'); END`);
    const before=await state();try {assert.equal((await save("preferences",{version:before.preferences.version,shareBirthday:true},employee,before)).status,503);assert.equal((await state()).preferences.shareBirthday,false);}finally{await db.run(sql`DROP TRIGGER p2_audit_fail`);}
    await ok(await save("moderate",{shoutoutId:shoutout},owner));assert.equal((await state()).shoutouts.some(s=>s.id===shoutout),false);assert.equal((await db.select().from(s.teamShoutouts)).length,2);
    await assert.rejects(db.run(sql`UPDATE team_shoutouts SET body='changed'`));await assert.rejects(db.run(sql`DELETE FROM shoutout_moderation`));
  });
  await t.test("messaging off, devices, CSRF, lost access and disabled recipients fail closed",async()=>{
    assert.equal((await community.handle(req("/api/community/state",`dombase-kiosk-device=${f.deviceToken}; ${employee}`))).status,403);
    const base=await state();assert.equal((await community.handle(req("/api/community/preferences",employee,{id:r.newToken(),revision:base.revision,contextToken:base.contextToken,version:base.preferences.version,shareBirthday:true},{Origin:"https://outside.example"}))).status,403);
    await db.update(s.locationSettings).set({enableTeamMessaging:false}).where(eq(s.locationSettings.businessId,1));assert.equal((await state()).canSend,false);assert.deepEqual((await state()).shoutouts,[]);assert.equal((await save("shoutouts",{recipientId:f.managerEmployee.id,category:"teamwork",message:"Disabled"})).status,403);
    await db.update(s.locationSettings).set({enableTeamMessaging:true}).where(eq(s.locationSettings.businessId,1));await db.update(s.employees).set({active:false}).where(eq(s.employees.id,f.managerEmployee.id));assert.equal((await save("shoutouts",{recipientId:f.managerEmployee.id,category:"teamwork",message:"Inactive"})).status,403);
  });
  await t.test("punctuality reflects appended time-card corrections while raw punches stay immutable",async()=>{
    const [card]=await db.insert(s.timeCards).values({employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,workDate:"2026-11-02",source:"punch"}).returning();
    const ids=f.p2Events.slice(4,6).map(e=>e.id);
    await db.insert(s.timeCardEdits).values({cardId:card.id,employeeId:f.a.id,revision:1,actorAccountId:f.owner.id,reason:"Fictional correction",before:{eventIds:ids},after:{events:[{id:ids[0],employeeId:f.a.id,type:"in",at:"2026-11-02T17:00:00.000Z",role:f.roleA.name},{id:ids[1],employeeId:f.a.id,type:"out",at:"2026-11-03T01:00:00.000Z",role:f.roleA.name}]}});
    const a=(await report()).people.find(p=>p.id===f.a.id);assert.equal(a.punctualityRate,100);assert.equal(a.late,0);assert.equal((await db.select().from(s.clockEvents).where(eq(s.clockEvents.id,ids[0])))[0].occurredAt,"2026-11-02T17:10:00.000Z");
  });
  await t.test("shout-out throttling enforces the stored hourly limit without partial extra writes",async()=>{
    const count=(await db.select().from(s.teamShoutouts).where(eq(s.teamShoutouts.actorAccountId,f.employeeAccount.id))).length;
    for(let i=count;i<20;i++)await ok(await save("shoutouts",{recipientId:f.multi.id,category:"great_work",message:`Fictional rate fixture ${i}`}));
    assert.equal((await save("shoutouts",{recipientId:f.multi.id,category:"great_work",message:"Over the limit"})).status,429);
    assert.equal((await db.select().from(s.teamShoutouts).where(eq(s.teamShoutouts.actorAccountId,f.employeeAccount.id))).length,20);
  });
  await t.test("preferences, preserved recognition and reports survive native runtime restart",async()=>{
    const before=await state();await platform.dispose();await connect();assert.deepEqual(await state(),before);assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`),[]);assert.equal((await db.select().from(s.workforceWriteChecks)).length,0);
  });
  await t.test("revocation after session authentication still prevents a community write",async()=>{
    const base=await state();
    const racedAuth={...auth,getSession:async token=>{const session=await auth.getSession(token);if(session)await db.update(s.accounts).set({sessionVersion:sql`session_version+1`}).where(eq(s.accounts.id,f.employeeAccount.id));return session;}};
    const raced=r.createCommunityService(db,racedAuth,access,secret,now);
    const response=await raced.handle(req("/api/community/preferences",employee,{id:r.newToken(),revision:base.revision,contextToken:base.contextToken,version:base.preferences.version,shareBirthday:true}));assert.equal(response.status,409);assert.equal((await db.select().from(s.recognitionPreferences).where(eq(s.recognitionPreferences.employeeId,f.a.id)))[0].shareBirthday,false);
  });

});

test("P2 calendars handle exact expiry boundaries, leap birthdays, month ends and later yearly anniversaries",async()=>{
  const {certificateStatus,milestonesFor}=await loadServerModule("team/insights-rules.ts");
  assert.equal(certificateStatus("2027-01-09","2026-12-30"),"Due within 10 days");assert.equal(certificateStatus("2027-01-10","2026-12-30"),"Current");assert.equal(certificateStatus("2026-12-30","2026-12-30"),"Expires today");
  const p={id:1,name:"Fictional",startDate:"2024-08-31",birthdayMonthDay:"02-29"};assert.equal(milestonesFor(p,"2024-11-01","2024-11-30")[0].date,"2024-11-30");assert.equal(milestonesFor(p,"2025-02-01","2025-02-28").find(m=>m.kind==="birthday").date,"2025-02-28");assert.equal(milestonesFor(p,"2026-08-31","2026-08-31")[0].label,"2 years");
});


test("shift scores use location time across overnight DST, omit unfinished shifts and flag missing clock-outs",async()=>{
  const {reliabilityFor,reliabilityTotals,earnedAchievements}=await loadServerModule("team/insights-rules.ts");
  const shift={id:1,employeeId:1,date:"2026-10-31",start:"22:00",end:"06:00",role:"Overnight",station:"Floor"};
  const state={employees:[{id:1,name:"Fictional"}],shifts:[shift],ptoRequests:[],clockEvents:[{id:1,employeeId:1,type:"in",at:"2026-11-01T05:00:00.000Z"},{id:2,employeeId:1,type:"break",at:"2026-11-01T09:00:00.000Z"},{id:3,employeeId:1,type:"break_end",at:"2026-11-01T09:30:00.000Z"},{id:4,employeeId:1,type:"out",at:"2026-11-01T14:00:00.000Z",automatic:true}]};
  const settings={lateMinutes:1,mandatoryMealBreak:true,mealBreakAfterHours:5},done=Date.parse("2026-11-01T15:00:00Z");const rows=reliabilityFor(state,shift.date,shift.date,done,settings);
  assert.equal(rows[0].workedHours,8.5);assert.equal(rows[0].status,"On time");assert.equal(rows[0].automaticClockOut,true);assert.equal(rows[0].missedBreak,false);
  const open=reliabilityFor(state,shift.date,shift.date,Date.parse("2026-11-01T10:00:00Z"),settings);assert.equal(open[0].status,"In progress");assert.equal(reliabilityTotals(open).onTimeShiftScore,null);
  const missing=reliabilityFor({...state,clockEvents:state.clockEvents.slice(0,3)},shift.date,shift.date,done,settings);assert.equal(missing[0].missingClockOut,true);assert.deepEqual(earnedAchievements(missing,0),[]);
});
