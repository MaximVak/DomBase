import assert from "node:assert/strict";
import test from "node:test";
import {mkdir,mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {eq,sql} from "drizzle-orm";
import {drizzle} from "drizzle-orm/d1";
import {projectRoot,configPath,runLocalDb} from "../scripts/local-db.mjs";
import {loadServerModule} from "../scripts/server-runtime.mjs";
import {seedWorkforceFixture,fieldKey} from "./support/workforce-fixture.mjs";
import {invitationEmailConfig,invitationEmailConfigBlock} from "../team/email-config.mjs";

test("invitation email config rejects header injection, unsafe origins and widened bindings",()=>{
 assert.equal(invitationEmailConfig({}).configured,false);
 const vars={INVITATION_EMAIL_FROM:"invites@example.test",INVITATION_EMAIL_REPLY_TO:"ops@example.test",INVITATION_EMAIL_ORIGIN:"https://app.example.test"};
 const block={vars,send_email:[{name:"INVITATION_EMAIL",allowed_sender_addresses:[vars.INVITATION_EMAIL_FROM]}]};
 assert.deepEqual(invitationEmailConfigBlock(block),block);
 for(const origin of ["http://app.example.test","https://app.example.test/path","https://a:b@app.example.test","https://app.example.test/"])assert.throws(()=>invitationEmailConfigBlock({...block,vars:{...vars,INVITATION_EMAIL_ORIGIN:origin}}));
 assert.throws(()=>invitationEmailConfigBlock({...block,vars:{...vars,INVITATION_EMAIL_REPLY_TO:"ops@example.test\r\nBcc:other@example.test"}}));
 assert.throws(()=>invitationEmailConfigBlock({...block,send_email:[{name:"INVITATION_EMAIL"}]}));
});

test("durable invitation delivery preserves scope, retries, single-use links and atomic saves",{timeout:180000},async t=>{
 await mkdir(join(projectRoot,".wrangler"),{recursive:true});const path=await mkdtemp(join(projectRoot,".wrangler/invitation-email-test-"));let platform;
 t.after(async()=>{try{await platform?.dispose();}finally{await rm(path,{recursive:true,force:true});}});
 await runLocalDb("migrate",[],path);const {getPlatformProxy}=await import("wrangler");
 const s=await loadServerModule("db/schema.ts");const runtime=await loadServerModule("tests/support/workforce-runtime.ts");const {dispatchInvitationEmails}=await loadServerModule("team/email.ts");
 let time=Date.now();const now=()=>time;const secret="isolated-invitation-email-verification-secret";let db,team,invites,auth,access;
 async function connect(){platform=await getPlatformProxy({configPath,persist:{path:join(path,"v3")},remoteBindings:false,envFiles:[]});db=drizzle(platform.env.DB,{schema:s});auth=runtime.createAuthService(db,{secret});access=runtime.createAccessService(db,auth);team=runtime.createTeamService(db,access,{secret,fieldKey,now,emailEnabled:true});invites=runtime.createInvitationService(db,secret,now);}
 await connect();const password="Isolated invitation email test passphrase!";const f=await seedWorkforceFixture(db,s,loadServerModule,password);
 const origin="http://localhost:3000";const req=(path,cookie="",body)=>new Request(origin+path,{method:body===undefined?"GET":"POST",headers:{Cookie:cookie,...(body===undefined?{}:{Origin:origin,"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const ok=async r=>{const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};const login=async email=>{const r=await auth.handle(req("/api/auth/login","",{email,password}));await ok(r);return r.headers.get("set-cookie").split(";")[0];};const owner=await login(f.owner.email);
 const state=()=>team.handle(req("/api/team/state",owner)).then(ok);
 const commit=async(operation,data,id=runtime.newToken())=>{const body={id,revision:(await state()).revision,operation,data};return {body,response:await team.handle(req("/api/team/commit",owner,body))};};
 let serial=0;async function queue(){const email="invite-"+(++serial)+"@example.test";const data={rows:[{name:"Fictional email invite "+serial,email,roleId:f.roleA.id,channel:"email"}]};await ok((await commit("bulk",data)).response);return (await db.select().from(s.teamInvitations).where(eq(s.teamInvitations.recipient,email)))[0];}
 const sent=[];let fail=false;const env={AUTH_PRIVATE_FIELD_KEY:fieldKey,INVITATION_EMAIL_FROM:"invites@example.test",INVITATION_EMAIL_REPLY_TO:"ops@example.test",INVITATION_EMAIL_ORIGIN:"https://app.example.test",INVITATION_EMAIL:{send:async message=>{if(fail)throw new Error("sensitive provider detail must never escape");sent.push(message);return {messageId:"fake-provider-ack"};}}};
 const job=async id=>(await db.select().from(s.invitationEmails).where(eq(s.invitationEmails.invitationId,id)))[0];
 await t.test("concurrent cron calls send once, expose safe status and accept only the invited identity",async()=>{
  const i=await queue();assert.equal((await job(i.id)).state,"pending");await Promise.all(Array.from({length:8},()=>dispatchInvitationEmails(db,env,time)));assert.equal(sent.length,1);assert.equal((await job(i.id)).state,"accepted");
  assert.equal(sent[0].to,i.recipient);assert.deepEqual(sent[0].from,{email:"invites@example.test",name:"Molding Mart"});assert.equal(sent[0].subject,"Molding Mart: your DomBase invitation");assert.match(sent[0].text,/Molding Mart invited you/);assert.match(sent[0].text,/Pacific time/);assert.equal(sent[0].replyTo,"ops@example.test");assert.match(sent[0].text,/https:\/\/app.example.test\/invite#token=/);assert.doesNotMatch(sent[0].text,/SSN|wage|AUTH_|Private legal/);assert.equal(Object.hasOwn(sent[0],"cc"),false);
  const token=sent[0].text.match(/#token=([\w-]{43})/)[1];const snapshot=JSON.stringify(await state());assert.doesNotMatch(snapshot,new RegExp(token));assert.doesNotMatch(snapshot,/localTokenEncrypted|tokenHash|leaseToken/);
  assert.equal((await invites.handle(req("/api/invitations/accept","",{token,email:"other@example.test",password}))).status,400);
  await ok(await invites.handle(req("/api/invitations/accept","",{token,email:i.recipient,password})));assert.equal((await invites.handle(req("/api/invitations/inspect","",{token}))).status,401);
  const [account]=await db.select().from(s.accounts).where(eq(s.accounts.normalizedEmail,i.recipient));assert.equal(account.accessLevel,"employee");await dispatchInvitationEmails(db,env,time);assert.equal(sent.length,1);
 });
 await t.test("provider failure is separate from save and survives restart with cooldown",async()=>{
  const i=await queue();fail=true;await dispatchInvitationEmails(db,env,time);assert.equal((await job(i.id)).attempts,1);assert.equal((await job(i.id)).state,"pending");await dispatchInvitationEmails(db,env,time+30000);assert.equal((await job(i.id)).attempts,1);
  await platform.dispose();await connect();fail=false;time+=60001;await dispatchInvitationEmails(db,env,time);assert.equal((await job(i.id)).state,"accepted");assert.equal((await job(i.id)).attempts,2);
 });
 await t.test("resend revokes the old link and saves only one queued invitation on replay",async()=>{
  const old=await queue();const person=(await state()).employees.find(e=>e.id===old.employeeId);const {body,response}=await commit("invite",{employeeId:person.id,version:person.version,channel:"email"});await ok(response);await ok(await team.handle(req("/api/team/commit",owner,body)));
  const all=await db.select().from(s.teamInvitations).where(eq(s.teamInvitations.employeeId,person.id));assert.equal(all.length,2);assert.equal(all.filter(i=>!i.revokedAt).length,1);const count=sent.length;await dispatchInvitationEmails(db,env,time);assert.equal(sent.length,count+1);assert.equal((await job(old.id)).state,"cancelled");
 });
 await t.test("expiry, termination, changed contact and issuer revocation prevent sending",async()=>{
  for(const reason of ["expired","terminated","contact","issuer"]){const i=await queue();if(reason==="expired")await db.update(s.teamInvitations).set({expiresAt:new Date(time-1).toISOString()}).where(eq(s.teamInvitations.id,i.id));if(reason==="terminated")await db.update(s.employees).set({active:false,terminated:true}).where(eq(s.employees.id,i.employeeId));if(reason==="contact")await db.update(s.employees).set({email:"changed@example.test"}).where(eq(s.employees.id,i.employeeId));if(reason==="issuer")await db.update(s.teamInvitations).set({issuerVersion:999}).where(eq(s.teamInvitations.id,i.id));const count=sent.length;await dispatchInvitationEmails(db,env,time);assert.equal(sent.length,count);assert.equal((await job(i.id)).state,"cancelled");}
 });
 await t.test("missing config cannot send; invalid batches roll back both employees and queue",async()=>{
  const i=await queue();const count=sent.length;await dispatchInvitationEmails(db,{...env,INVITATION_EMAIL:undefined},time);assert.equal(sent.length,count);assert.equal((await job(i.id)).attempts,0);
  const before=await db.select().from(s.invitationEmails);const r=await commit("bulk",{rows:[{name:"Must roll back",email:"rollback@example.test",roleId:f.roleA.id,channel:"email"},{name:"Invalid role",email:"bad@example.test",roleId:99999,channel:"email"}]});assert.equal(r.response.status,403);assert.equal((await db.select().from(s.invitationEmails)).length,before.length);assert.equal((await db.select().from(s.employees).where(eq(s.employees.email,"rollback@example.test"))).length,0);
  await dispatchInvitationEmails(db,env,time);
 });
 await t.test("exhausted retries require resend; stale leases recover without concurrent duplicate sends",async()=>{
  const i=await queue();fail=true;for(const wait of [0,60001,300001,900001]){time+=wait;await dispatchInvitationEmails(db,env,time);}assert.equal((await job(i.id)).state,"failed");assert.equal((await job(i.id)).attempts,4);fail=false;
  const next=await queue();await db.update(s.invitationEmails).set({state:"sending",leaseToken:"crashed",leaseUntil:new Date(time+60000).toISOString()}).where(eq(s.invitationEmails.invitationId,next.id));const count=sent.length;await dispatchInvitationEmails(db,env,time);assert.equal(sent.length,count);time+=60001;await Promise.all([dispatchInvitationEmails(db,env,time),dispatchInvitationEmails(db,env,time)]);assert.equal(sent.length,count+1);
 });
 await t.test("manager queue loses eligibility after scope or invite permission removal",async()=>{
  const manager=await login(f.manager.email);for(const reason of ["scope","permission"]){
   await db.insert(s.accountPermissions).values([{accountId:f.manager.id,permission:"team.invite",allowed:true},{accountId:f.manager.id,permission:"team.contact.read",allowed:true}]).onConflictDoUpdate({target:[s.accountPermissions.accountId,s.accountPermissions.permission],set:{allowed:true}});
   await db.insert(s.departmentManagers).values({accountId:f.manager.id,departmentId:f.deptA.id}).onConflictDoNothing();const i=await queue();await db.update(s.teamInvitations).set({issuedByAccountId:f.manager.id,issuerVersion:f.manager.sessionVersion}).where(eq(s.teamInvitations.id,i.id));
   if(reason==="scope")await db.delete(s.departmentManagers).where(eq(s.departmentManagers.accountId,f.manager.id));else await db.update(s.accountPermissions).set({allowed:false}).where(sql`account_id = ${f.manager.id} AND permission = 'team.invite'`);
   const count=sent.length;await dispatchInvitationEmails(db,env,time);assert.equal(sent.length,count);assert.equal((await job(i.id)).state,"cancelled");
  }
  assert.ok(manager);
 });
});
