import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { startAuthApp } from "./support/auth-app-fixture.mjs";
import { seedP2Fixture } from "./support/p2-fixture.mjs";
test("built Worker serves protected P2 reports and own employee recognition across fresh sign-ins",{timeout:120000},async t=>{
  const app=await startAuthApp({seed:seedP2Fixture});t.after(app.close);const f=app.fixtureData;
  const call=(path,cookie="",body,headers={})=>fetch(app.origin+path,{redirect:"manual",method:body===undefined?"GET":"POST",headers:{Cookie:cookie,...(body===undefined?{}:{Origin:app.origin,"Content-Type":"application/json"}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
  const login=async email=>{const res=await call("/api/auth/login","",{email,password:app.password});await ok(res);return res.headers.get("set-cookie").split(";")[0];};
  const owner=await login(app.email),employee=await login(f.employeeAccount.email);
  assert.equal((await call("/team/reports")).headers.get("location"),"/login");assert.equal((await call("/team/reports",employee)).headers.get("location"),"/login");
  for(const [path,cookie,label] of [["/team/reports",owner,/Team reports/],["/community",employee,/Achievements/]]){const response=await call(path,cookie);assert.equal(response.status,200);assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(response.headers.get("x-frame-options"),"DENY");assert.match(await response.text(),label);}
  const report=await ok(await call("/api/team/insights?start=2026-11-01&end=2026-11-04",owner));assert.equal(report.canCertificates,true);assert.ok(report.shifts.some(s=>s.employeeId===f.a.id&&s.status==="Late"));assert.doesNotMatch(JSON.stringify(report),/MEDICAL|1990|1985|amountCents/);
  assert.equal((await call("/api/team/insights",employee)).status,401);
  const base=await ok(await call("/api/community/state",employee));assert.ok(base.peers.every(p=>Object.keys(p).sort().join(",")==="id,name"));assert.ok(base.achievements.some(a=>a.id==="shifts:1"));
  const preferences={id:randomBytes(32).toString("base64url"),revision:base.revision,contextToken:base.contextToken,version:base.preferences.version,shareBirthday:true};await ok(await call("/api/community/preferences",employee,preferences));
  assert.equal((await call("/api/community/preferences",employee,{...preferences,id:randomBytes(32).toString("base64url")},{Origin:"https://outside.example"})).status,403);
  let data=await ok(await call("/api/community/state",employee));const body={id:randomBytes(32).toString("base64url"),revision:data.revision,contextToken:data.contextToken,recipientId:f.managerEmployee.id,category:"helpfulness",message:"Fictional HTTP appreciation <script>unsafe()</script>"};await ok(await call("/api/community/shoutouts",employee,body));await ok(await call("/api/community/shoutouts",employee,body));
  const fresh=await login(f.employeeAccount.email);data=await ok(await call("/api/community/state",fresh));assert.equal(data.preferences.shareBirthday,true);assert.equal(data.shoutouts.length,1);assert.equal(data.shoutouts[0].body,body.message);
  assert.equal((await call("/api/community/preferences",fresh,{...preferences,id:randomBytes(32).toString("base64url"),revision:data.revision,version:data.preferences.version})).status,409);
  const manager=await login(f.manager.email);const received=await ok(await call("/api/community/state",manager));assert.equal(received.shoutouts[0].recipientId,f.managerEmployee.id);assert.equal(received.peers.some(p=>p.id===f.b.id),false);
  assert.equal((await call("/api/community/state",`dombase-kiosk-device=${f.deviceToken}; ${employee}`)).status,403);assert.equal((await call("/community",`dombase-kiosk-device=${f.deviceToken}; ${employee}`)).headers.get("location"),"/kiosk");
  const moderated=await ok(await call("/api/community/state",owner));await ok(await call("/api/community/moderate",owner,{id:randomBytes(32).toString("base64url"),revision:moderated.revision,contextToken:moderated.contextToken,shoutoutId:body.id}));assert.deepEqual((await ok(await call("/api/community/state",fresh))).shoutouts,[]);
});
