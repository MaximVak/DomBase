import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {drizzle} from 'drizzle-orm/d1';
import {configPath,projectRoot,runLocalDb} from '../scripts/local-db.mjs';
import {loadServerModule} from '../scripts/server-runtime.mjs';
import {seedWorkforceFixture,fieldKey} from './support/workforce-fixture.mjs';

test('both manager assignment screens use account identity, permissions, version checks and session revocation', {timeout:120000}, async t=>{
 const state=await mkdtemp(join(projectRoot,'.wrangler/assignment-check-'));let platform;
 t.after(async()=>{try{await platform?.dispose();}finally{await rm(state,{recursive:true,force:true});}});
 await runLocalDb('migrate',[],state);const {getPlatformProxy}=await import('wrangler');
 platform=await getPlatformProxy({configPath,persist:{path:join(state,'v3')},remoteBindings:false,envFiles:[]});
 const schema=await loadServerModule('db/schema.ts');
 const {createAuthService,createAccessService,createWorkforceService,newToken,saveBody}=await loadServerModule('tests/support/workforce-runtime.ts');
 const {changeManagerDepartment}=await loadServerModule('app/department-manager-actions.ts');
 const db=drizzle(platform.env.DB,{schema}),password='Isolated manager assignment verification!';
 const f=await seedWorkforceFixture(db,schema,loadServerModule,password),secret='isolated-manager-assignments-secret-at-least-32';
 const auth=createAuthService(db,{secret}),access=createAccessService(db,auth),workspace=createWorkforceService(db,access,{secret,fieldKey});
 const origin='http://localhost:3000';
 const req=(path,cookie,body)=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const ok=async r=>{const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 const login=async person=>{const r=await auth.handle(req('/api/auth/login','',{email:person.email,password}));await ok(r);return r.headers.getSetCookie()[0].split(';')[0];};
 const owner=await login(f.owner),manager=await login(f.manager),general=await login(f.generalManager),unlinked=await login(f.unassigned);
 const call=(path,body,cookie=owner)=>access.handle(req('/api/access/'+path,cookie,body));
 const read=()=>workspace.handle(req('/api/workspace/state',owner)).then(ok);
 const current=()=>call(`accounts/${f.unassigned.id}`).then(ok);
 const request=async(path,_signal,body)=>{const r=await call(path,body);if(r.status!==200)throw new Error((await r.json()).error);return r.json();};
 await t.test('department screen lists unlinked Managers by account ID and shares the account screen state',async()=>{
  const list=await ok(await call('accounts'));assert.equal(list.accounts.find(a=>a.id===f.unassigned.id).employeeId,null);
  assert.ok(list.departmentAssignments.some(a=>a.accountId===f.manager.id&&a.departmentId===f.deptA.id));
  assert.notEqual(f.manager.id,f.managerEmployee.id);
  let original=await current();
  const updated=await changeManagerDepartment(original.account,f.deptA.id,true,request);
  assert.deepEqual(updated.departmentIds,[f.deptA.id]);assert.deepEqual(updated.permissions,original.permissions);
  assert.equal((await auth.handle(req('/api/auth/session',unlinked))).status,401);
  assert.ok((await read()).departmentManagers.some(a=>a.accountId===f.unassigned.id&&a.departmentId===f.deptA.id&&a.name===f.unassigned.displayName));
  const second=await changeManagerDepartment(updated.account,f.deptB.id,true,request);
  assert.deepEqual(second.departmentIds.sort(),[f.deptA.id,f.deptB.id].sort());
  const removed=await changeManagerDepartment(second.account,f.deptA.id,false,request);
  assert.deepEqual(removed.departmentIds,[f.deptB.id]);
 });
 await t.test('account-screen edits appear in department projection and stale department saves cannot overwrite them',async()=>{
  const stale=await current();
  const result=await ok(await call(`accounts/${f.unassigned.id}/lifecycle`,{version:stale.account.version,email:stale.account.email,displayName:stale.account.displayName,employeeId:null,accessLevel:'manager',departmentIds:[f.deptA.id],disabled:false}));
  const projection=(await read()).departmentManagers.filter(a=>a.accountId===f.unassigned.id);
  assert.deepEqual(projection.map(a=>a.departmentId),[f.deptA.id]);
  await assert.rejects(changeManagerDepartment(stale.account,f.deptB.id,true,request),/changed.*Reload/);
  assert.equal((await current()).account.version,result.account.version);
  assert.deepEqual((await current()).departmentIds,[f.deptA.id]);
 });
 await t.test('General Managers remain company-wide, and all assignment writes remain Owner-only',async()=>{
  const gm=await ok(await call(`accounts/${f.generalManager.id}`));
  assert.equal((await call(`accounts/${gm.account.id}`,{version:gm.account.version,permissions:gm.permissions,departmentIds:[f.deptA.id]})).status,400);
  assert.deepEqual((await ok(await call(`accounts/${gm.account.id}`))).departmentIds,[]);
  await assert.rejects(changeManagerDepartment(gm.account,f.deptA.id,true,request),/changed/);
  for(const cookie of [manager,general]){
   assert.equal((await call('accounts',undefined,cookie)).status,403);
   const target=await current();assert.equal((await call(`accounts/${target.account.id}`,{version:target.account.version,permissions:target.permissions,departmentIds:[]},cookie)).status,403);
  }
  const base=await read(),before=base.state.departments.find(d=>d.id===f.deptA.id);
  const forged={entity:'department',id:before.id,before,after:{...before,managerIds:[f.multi.id]}};
  const denied=await workspace.handle(req('/api/workspace/commit',owner,saveBody(base,[forged],newToken())));
  assert.equal(denied.status,403);assert.equal((await read()).revision,base.revision);
 });
 await t.test('disabled and password-pending account assignments stay visible instead of silently disappearing',async()=>{
  let target=await current();
  await ok(await call(`accounts/${target.account.id}/lifecycle`,{version:target.account.version,email:target.account.email,displayName:target.account.displayName,employeeId:null,accessLevel:'manager',departmentIds:[f.deptA.id],disabled:true}));
  const projection=(await read()).departmentManagers.find(a=>a.accountId===target.account.id);assert.equal(projection.disabled,true);
  const list=await ok(await call('accounts'));assert.ok(list.departmentAssignments.some(a=>a.accountId===target.account.id&&a.departmentId===f.deptA.id));
  const pending=await ok(await call('accounts',{email:'pending-assignment@example.test',displayName:'Pending unlinked manager',employeeId:null,accessLevel:'manager',departmentIds:[f.deptA.id]}));
  assert.equal(pending.account.loginEnabled,false);
  assert.equal((await read()).departmentManagers.find(a=>a.accountId===pending.account.id).setupPending,true);
 });
});
