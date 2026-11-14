import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { configPath, projectRoot, runLocalDb } from "../scripts/local-db.mjs";
import { loadServerModule } from "../scripts/server-runtime.mjs";
import { seedWorkforceFixture, fieldKey } from "./support/workforce-fixture.mjs";

test("schedule warnings use full private context and preserve permissions and advisory saves", { timeout: 120000 }, async t => {
  await mkdir(join(projectRoot, ".wrangler"), { recursive: true });
  const statePath = await mkdtemp(join(projectRoot, ".wrangler/s05-")); let platform;
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
  const snapshot = (cookie = owner) => call("state", cookie).then(ok);
  const draft = async (upserts, deleted = [], cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-draft", id: 1, before: view.state.scheduleDraftsByManager[key] ?? null,
      after: { upsertedShifts: upserts, deletedShiftIds: deleted, affectedEmployeeIds: upserts.map(s => s.employeeId) } }], newToken()));
  };
  const publish = async (cookie = owner, key = f.b.id) => {
    const view = await snapshot(cookie);
    return call("commit", cookie, saveBody(view, [{ entity: "schedule-publish", id: 1, before: view.state.scheduleDraftsByManager[key], after: { publish: true } }], newToken()));
  };
  const period={start:"2026-11-09",end:"2026-11-15"};
  const minimal = s => ({ id:s.id,employeeId:s.employeeId,date:s.date,start:s.start,end:s.end,role:s.role,shiftType:s.shiftType??"work" });
  const warnings = async (cookie=owner,upserts=[],deletedShiftIds=[]) => { const view=await snapshot(cookie); return call("schedule-conflicts",cookie,{period,revision:view.revision,upserts:upserts.map(minimal),deletedShiftIds}); };
  const seededShifts = [
    {id:87001,employeeId:f.a.id,roleId:f.roleA.id,roleName:f.roleA.name,date:"2026-11-09",startTime:"09:00",endTime:"18:00",notes:"Private original note"},
    {id:87002,employeeId:f.b.id,roleId:f.roleB.id,roleName:f.roleB.name,date:"2026-11-13",startTime:"09:00",endTime:"17:00",notes:"Hidden department B note"},
    {id:87003,employeeId:f.multi.id,roleId:f.roleA.id,roleName:f.roleA.name,date:"2026-11-09",startTime:"09:00",endTime:"17:00"},
    {id:87004,employeeId:f.multi.id,roleId:f.roleB.id,roleName:f.roleB.name,date:"2026-11-08",startTime:"20:00",endTime:"23:30"},
    ...[10,11,12,13,14].map((day,i)=>({id:87005+i,employeeId:f.multi.id,roleId:f.roleB.id,roleName:f.roleB.name,date:`2026-11-${day}`,startTime:"09:00",endTime:"17:00",notes:"Other-department shift details"})),
  ];
  for (const shift of seededShifts) await db.insert(s.shifts).values(shift);
  const [availability]=await db.insert(s.availabilityRequests).values({employeeId:f.a.id,submittedByAccountId:f.employeeAccount.id,effectiveDate:"2026-01-01",submittedAt:"2026-07-01T20:00:00Z",status:"approved",requestNote:"Private availability explanation"}).returning();
  await db.insert(s.availabilitySlots).values({requestId:availability.id,dayOfWeek:1,startMinute:600,endMinute:660,preference:"unavailable"});
  await db.insert(s.ptoRequests).values({employeeId:f.a.id,compensation:"unpaid",startDate:"2026-11-09",endDate:"2026-11-09",startTime:"10:30",endTime:"12:00",reason:"sick_emergency",explanation:"Private medical explanation",status:"approved"});
  await t.test("all warning types are read-only; scoped managers get cross-department risk without hidden data or wages", async()=>{
    const before=await db.select().from(s.workforceState),audits=await db.select().from(s.auditLog),shifts=await db.select().from(s.shifts);
    const result=await ok(await warnings());const a=result.warnings.find(r=>r.shiftId===87001);for(const code of ["unavailable","availability_outdated","time_off","overtime"])assert.ok(a.codes.includes(code));
    const scoped=await ok(await warnings(manager));const multi=scoped.warnings.find(r=>r.shiftId===87003);assert.ok(multi.codes.includes("overtime"));assert.ok(multi.codes.includes("short_rest"));
    assert.ok(scoped.warnings.every(r=>[87001,87003].includes(r.shiftId)));
    assert.doesNotMatch(JSON.stringify(scoped),/Hidden|Other-department|Private|amountCents|wageRates|basis|roleId|employeeId|startTime|endTime|explanation|notes/);
    assert.deepEqual(await db.select().from(s.workforceState),before);assert.deepEqual(await db.select().from(s.auditLog),audits);assert.deepEqual(await db.select().from(s.shifts),shifts);
  });
  await t.test("permission revocation suppresses availability and leave assessment rather than manufacturing a clear result",async()=>{
    await db.insert(s.accountPermissions).values([{accountId:f.manager.id,permission:"availability.read",allowed:false},{accountId:f.manager.id,permission:"time_off.read",allowed:false}]);
    const hidden=await ok(await warnings(manager));assert.equal(hidden.availability,false);assert.equal(hidden.timeOff,false);
    assert.ok(hidden.warnings.every(r=>r.codes.every(c=>!["unavailable","availability_outdated","availability_missing","time_off"].includes(c))));
    assert.ok(hidden.warnings.find(r=>r.shiftId===87003).codes.includes("short_rest"));
  });
  await t.test("selectors, CSRF, oversized ranges, stale revisions and forbidden role simulations are rejected",async()=>{
    assert.equal((await call("schedule-conflicts",employee,{period,revision:0,upserts:[],deletedShiftIds:[]})).status,401);
    assert.equal((await call("schedule-conflicts",owner)).status,405);
    const view=await snapshot();const payload={period,revision:view.revision,upserts:[],deletedShiftIds:[]};
    assert.equal((await call("schedule-conflicts",owner,{...payload,employeeId:f.b.id})).status,400);
    assert.equal((await call("schedule-conflicts",owner,{...payload,revision:payload.revision+1})).status,409);
    assert.equal((await call("schedule-conflicts",owner,{...payload,period:{start:"2026-01-01",end:"2026-12-31"}})).status,400);
    const csrf=request("/api/workspace/schedule-conflicts",owner,payload);csrf.headers.set("Origin","https://untrusted.example.test");assert.equal((await workspace.handle(csrf)).status,403);
    const hiddenShift={id:-1,employeeId:f.multi.id,date:"2026-11-13",start:"08:00",end:"12:00",role:f.roleB.name};
    assert.equal((await warnings(manager,[hiddenShift])).status,404);assert.equal((await warnings(manager,[],[87004])).status,404);
    await db.insert(s.accountPermissions).values({accountId:f.manager.id,permission:"schedule.manage",allowed:false});assert.equal((await warnings(manager,[{...hiddenShift,role:f.roleA.name}])).status,403);assert.equal((await warnings(manager)).status,200);
  });
  await t.test("a full draft uses bounded JSON selectors instead of exceeding D1 parameter limits",async()=>{
    const upserts=Array.from({length:100},(_,i)=>({id:89000+i,employeeId:f.a.id,date:"2026-11-13",start:"08:00",end:"09:00",role:f.roleA.name}));
    assert.equal((await warnings(owner,upserts)).status,200);
  });
  await t.test("settings save behind authorization and revisions, with unchanged plans and original values restorable",async()=>{
    const view=await snapshot(),original={...view.settings,hoursRoundingMinutes:view.state.hoursRoundingMinutes},shifts=await db.select().from(s.shifts),preferences=await db.select().from(s.availabilityRequests);
    assert.equal(original.minRestHours,10);assert.equal(original.availabilityReviewDays,90);
    const save=(v,values,cookie=owner)=>call("commit",cookie,saveBody(v,[{entity:"settings",id:1,before:{...v.settings,hoursRoundingMinutes:v.state.hoursRoundingMinutes},after:{...v.settings,hoursRoundingMinutes:v.state.hoursRoundingMinutes,...values}}],newToken()));
    assert.equal((await save(view,{minRestHours:25})).status,400);assert.equal((await save(await snapshot(manager),{minRestHours:5},manager)).status,403);
    await ok(await save(view,{minRestHours:0,availabilityReviewDays:0}));assert.equal((await save(view,{minRestHours:9})).status,409);
    const off=await ok(await warnings());assert.ok(off.warnings.every(r=>!r.codes.includes("short_rest")&&!r.codes.includes("availability_outdated")));
    assert.ok(off.warnings.find(r=>r.shiftId===87001).codes.includes("unavailable"));await ok(await save(await snapshot(),original));
    assert.deepEqual(await db.select().from(s.shifts),shifts);assert.deepEqual(await db.select().from(s.availabilityRequests),preferences);
  });
  await t.test("warnings follow saved drafts and previews, while conflicts remain publishable without editing punches",async()=>{
    const shift={id:87020,employeeId:f.a.id,date:"2026-11-09",start:"12:00",end:"14:00",role:f.roleA.name,station:"Floor",notes:"",shiftType:"work",color:"amber"};
    const existing=(await snapshot()).state.shifts.find(s=>s.id===87001);
    await ok(await draft([{...existing,start:"08:00",end:"18:00"}]));
    const v=await snapshot();const draftShifts=v.state.scheduleDraftsByManager[f.b.id].upsertedShifts;
    const response=await ok(await warnings(owner,draftShifts));assert.ok(response.warnings.find(r=>r.shiftId===87001).codes.includes("time_off"));
    const simulated=await ok(await warnings(owner,[{...shift,id:-1,start:"08:00",end:"18:00"}],[87001]));assert.ok(simulated.warnings.find(r=>r.shiftId===-1).codes.includes("time_off"));
    const punches=await db.select().from(s.clockEvents);await ok(await publish());
    const after=await snapshot();assert.ok(after.state.shifts.some(s=>s.id===87001));assert.deepEqual(await db.select().from(s.clockEvents),punches);
    assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`),[]);
  });
});
