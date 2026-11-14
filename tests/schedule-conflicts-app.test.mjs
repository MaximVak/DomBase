import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {startAuthApp} from './support/auth-app-fixture.mjs';
import {seedSelfScheduleFixture} from './support/self-schedule-fixture.mjs';
import {loadServerModule} from '../scripts/server-runtime.mjs';

test('built Worker exposes private advisory warnings and editable defaults without mutating published shifts', {timeout:120000}, async t=>{
 const app=await startAuthApp({seed:seedSelfScheduleFixture});t.after(app.close);
 const call=(path,cookie='',body)=>fetch(app.origin+path,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Cookie:cookie,Connection:'close',...(body===undefined?{}:{Origin:app.origin,'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})}).then(async response=>new Response(await response.arrayBuffer(),{status:response.status,statusText:response.statusText,headers:response.headers}));
 const ok=async r=>{const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};
 const login=async account=>{const r=await call('/api/auth/login','',{email:account.email,password:app.password});await ok(r);return r.headers.get('set-cookie').split(';')[0];};
 const f=app.fixtureData,owner=await login(f.owner),manager=await login(f.manager),employee=await login(f.employeeAccount),path='/api/workspace/schedule-conflicts';
 const snapshot=cookie=>call('/api/workspace/state?start=2026-11-01&end=2026-11-30',cookie).then(ok);
 const before=await snapshot(owner),period={start:'2026-11-09',end:'2026-11-15'},payload={period,revision:before.revision,upserts:[],deletedShiftIds:[]};
 const r=await call(path,owner,payload);assert.match(r.headers.get('cache-control'),/no-store/);const warnings=await ok(r);
 assert.ok(warnings.warnings.find(row=>row.shiftId===f.scheduledShifts[0].id).codes.includes('time_off'));
 assert.ok(warnings.warnings.find(row=>row.shiftId===f.scheduledShifts[0].id).codes.includes('availability_missing'));
 const limited=await ok(await call(path,manager,payload));assert.ok(!limited.warnings.some(row=>row.shiftId===f.scheduledShifts[1].id));assert.doesNotMatch(JSON.stringify(limited),/amountCents|employeeName|notes|wageRates|basis|private/);

 const stale=await call(path,owner,{...payload,revision:payload.revision+1});assert.equal(stale.status,409,await stale.text());
 assert.deepEqual((await snapshot(owner)).state.shifts,before.state.shifts);
 assert.equal(before.settings.minRestHours,10);assert.equal(before.settings.availabilityReviewDays,90);
 const {saveBody}=await loadServerModule('workforce/changes.ts');
 const settings={...before.settings,hoursRoundingMinutes:before.state.hoursRoundingMinutes};
 await ok(await call('/api/workspace/commit',owner,saveBody(before,[{entity:'settings',id:1,before:settings,after:{...settings,minRestHours:8,availabilityReviewDays:30}}],randomBytes(32).toString('base64url'))));
 const saved=await snapshot(owner);assert.equal(saved.settings.minRestHours,8);assert.equal(saved.settings.availabilityReviewDays,30);assert.deepEqual(saved.state.shifts,before.state.shifts);
 assert.equal((await call(path,owner,payload)).status,409);assert.equal((await call(path,owner,{...payload,revision:saved.revision})).status,200);
 assert.equal((await call(path,employee,payload)).status,401);assert.equal((await call(path,'',payload)).status,401);
});
