import { and,eq,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { AuthError } from '../auth/http';
import { rateKey,tokenIsValid } from '../auth/crypto';
import { canonical } from './contract';
import * as v from './validation';
import type { Context,Database } from './context';
import { WorkspaceTransaction } from './transaction';
import { readScheduleConflicts } from './conflicts';
import { exchangeEligible,exchangeManagerScope,exchangeRevision,sameExchangeRevision,exchangeRequestPage,loadExchangeShift,requireExchangePair,shiftFingerprint,notifyExchange,exchangeInvalidations,writeExchangeInvalidations,exchangeShiftUnchanged,exchangeNoConflict } from './shift-exchanges-shared';
export function exchangeHeaderQuery(db:Database,ctx:Context){
 const allowed=ctx.permissions['schedule.read']&&ctx.permissions['schedule.manage'];
 return db.select({id:s.shiftExchangeRequests.id,requester:sql<string>`${s.employees.name}`.as('exchange_requester_name'),kind:s.shiftExchangeRequests.kind,at:s.shiftExchangeRequests.acceptedAt}).from(s.shiftExchangeRequests).innerJoin(s.employees,eq(s.employees.id,s.shiftExchangeRequests.requesterId)).where(and(allowed?sql`1=1`:sql`0=1`,exchangeManagerScope(ctx),eq(s.shiftExchangeRequests.status,'accepted'))).orderBy(sql`${s.shiftExchangeRequests.acceptedAt} DESC`,sql`${s.shiftExchangeRequests.id} DESC`).limit(50);
}
export async function readManagerExchanges(db:Database,ctx:Context,url:URL,options:{secret:string;now?:()=>number}){
 ctx.requirePermission('schedule.read');ctx.requirePermission('schedule.manage');const keys=['history','cursor','requestId'];if([...url.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length>1))throw new AuthError(400,'Invalid shift request filters.');
 const history=url.searchParams.get('history')??'false';if(!['true','false'].includes(history))throw new AuthError(400,'Choose a valid history filter.');
 const revision=await exchangeRevision(db,ctx.activeActor()),page=await exchangeRequestPage(db,ctx.activeActor(),exchangeManagerScope(ctx),options.secret,(options.now??Date.now)(),null,url.searchParams.has('cursor')?v.integer(Number(url.searchParams.get('cursor'))):null,history==='true',url.searchParams.has('requestId')?v.integer(Number(url.searchParams.get('requestId'))):null);await sameExchangeRevision(db,ctx.activeActor(),revision);return {revision,...page};
}
export async function decideManagerExchange(db:Database,ctx:Context,body:Record<string,unknown>,options:{secret:string;now?:()=>number;emailEnabled?:boolean}){
 ctx.requirePermission('schedule.read');ctx.requirePermission('schedule.manage');const action=v.oneOf(body.action,['decision-preview','decide']);v.keys(body,['action','revision','requestId','decision','reason',...action==='decide'?['id','reviewToken']:[]]);
 const revision=v.integer(body.revision,0),requestId=v.integer(body.requestId),decision=v.oneOf(body.decision,['approve','decline']),reason=v.text(body.reason??'',300),now=(options.now??Date.now)(),hash=`manager-exchange:${rateKey(options.secret,canonical(body))}`;
 const current=await exchangeRevision(db,ctx.activeActor());
 if(action==='decide'){
  if(!tokenIsValid(body.id))throw new AuthError(400,'Invalid save identifier.');const[prior]=await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id,body.id),ctx.activeActor())).limit(1);if(prior){if(prior.accountId!==ctx.account.id||prior.bodyHash!==hash)throw new AuthError(409,'Save identifier already in use.');return {saved:true,revision:prior.revision};}
 }
 if(current!==revision)throw new AuthError(409,'Shared data changed. Reload before reviewing.');
 const[parent]=await db.select().from(s.shiftExchangeRequests).where(and(eq(s.shiftExchangeRequests.id,requestId),exchangeManagerScope(ctx))).limit(1);if(!parent)throw new AuthError(404,'Request is outside your current access.');
 if(!['pending','accepted'].includes(parent.status))throw new AuthError(409,'This request is already closed.');
 const source=await loadExchangeShift(db,parent.sourceShiftId,ctx.activeActor()),offered=parent.offeredShiftId?await loadExchangeShift(db,parent.offeredShiftId,ctx.activeActor()):null;
 const proposals=[{id:source.id,employeeId:parent.selectedEmployeeId!,date:source.date,start:source.startTime,end:source.endTime,role:source.roleName,shiftType:'work'},...offered?[{id:offered.id,employeeId:parent.requesterId,date:offered.date,start:offered.startTime,end:offered.endTime,role:offered.roleName,shiftType:'work'}]:[]];
 const assessments=[];if(decision==='approve'){
  if(parent.status!=='accepted'||!parent.selectedEmployeeId)throw new AuthError(409,'A teammate must accept before manager approval.');
  await requireExchangePair(db,parent,source,parent.selectedEmployeeId,offered,ctx.activeActor(),options.secret,now);
  if(offered&&shiftFingerprint(offered,options.secret)!==parent.offeredFingerprint)throw new AuthError(409,'The return shift changed. Create a new request.');
  const roles=await db.select().from(s.roles).where(ctx.activeActor());for(const row of proposals)row.role=roles.find(role=>role.id===(row.id===source.id?source.roleId:offered?.roleId))?.name??row.role;
  const dates=proposals.map(row=>row.date).sort();const periods=Date.parse(dates.at(-1)!)-Date.parse(dates[0])<=61*86400000?[{start:dates[0],end:dates.at(-1)!}]:dates.map(date=>({start:date,end:date}));
  for(const period of periods)assessments.push(await readScheduleConflicts(db,ctx,{revision,period,upserts:proposals,deletedShiftIds:[]},true));
 }
 const reviewToken=rateKey(options.secret,canonical({actor:ctx.account.id,revision,id:parent.id,version:parent.version,source:shiftFingerprint(source,options.secret),offered:offered?shiftFingerprint(offered,options.secret):null,decision,reason}));
 await sameExchangeRevision(db,ctx.activeActor(),revision);
 if(action==='decision-preview')return {revision,reviewToken,decision,assessments,shifts:decision==='approve'?proposals:[]};
 if(body.reviewToken!==reviewToken)throw new AuthError(409,'Review this exact decision before saving.');
 const invites=await db.select().from(s.shiftExchangeInvitations).where(and(eq(s.shiftExchangeInvitations.requestId,parent.id),ctx.activeActor())).limit(2001);if(invites.length>2000)throw new AuthError(503,'Too many request recipients.');
 let guard=sql`${ctx.activeActor()} AND EXISTS (SELECT 1 FROM shift_exchange_requests WHERE id=${parent.id} AND ${exchangeManagerScope(ctx)})`;
 const ids=[source.id,...offered?[offered.id]:[]];if(decision==='approve')guard=sql`${guard} AND ${exchangeEligible(parent.selectedEmployeeId,source.roleId)} AND ${exchangeEligible(parent.requesterId,source.roleId)} AND ${exchangeNoConflict(parent.selectedEmployeeId,source,ids)} ${offered?sql`AND ${exchangeEligible(parent.requesterId,offered.roleId)} AND ${exchangeEligible(parent.selectedEmployeeId,offered.roleId)} AND ${exchangeNoConflict(parent.requesterId,offered,ids)}`:sql``} AND NOT EXISTS (SELECT 1 FROM clock_events WHERE shift_id IN (SELECT value FROM json_each(${JSON.stringify(ids)})))`;
 const tx=new WorkspaceTransaction(db,{account:ctx.account,activeActor:()=>guard},body.id as string,new Date(now).toISOString());
 const publicationId=await notifyExchange(db,tx,guard,[parent.requesterId,...invites.map(row=>row.employeeId)],!!options.emailEnabled,source.date);
 if(decision==='approve'){
  tx.update(s.shifts,{employeeId:parent.selectedEmployeeId,publicationId,version:source.version+1,updatedAt:tx.stamp},exchangeShiftUnchanged(source));
  if(offered)tx.update(s.shifts,{employeeId:parent.requesterId,publicationId,version:offered.version+1,updatedAt:tx.stamp},exchangeShiftUnchanged(offered));
  const invalidated=await exchangeInvalidations(db,ctx.activeActor(),ids,parent.id);writeExchangeInvalidations(tx,invalidated);
  tx.insertRows(s.auditLog,proposals.map(row=>({actorAccountId:ctx.account.id,employeeId:row.employeeId,action:'schedule.exchange_assignment',entityType:'shift',entityId:String(row.id),metadata:{requestId:parent.id,employeeId:row.employeeId,publicationId},createdAt:tx.stamp})));
 }
 tx.update(s.shiftExchangeRequests,{status:decision==='approve'?'approved':'declined',version:parent.version+1,decidedAt:tx.stamp,decidedByAccountId:ctx.account.id,reason:reason||(decision==='approve'?'Approved by manager.':'Not approved by manager.')},sql`id=${parent.id} AND version=${parent.version} AND status=${parent.status}`);
 tx.updateRows(s.shiftExchangeInvitations,invites.filter(row=>row.status==='pending'||row.status==='accepted').map(row=>({id:row.id,status:'closed',version:row.version+1,respondedAt:tx.stamp})),'id',sql`version=json_extract(entry.value,'$.version')-1`);
 tx.insert(s.auditLog,{actorAccountId:ctx.account.id,employeeId:parent.requesterId,action:`schedule.exchange_${decision}`,entityType:'shift-exchange',entityId:String(parent.id),metadata:{kind:parent.kind,sourceShiftId:source.id,offeredShiftId:offered?.id??null,publicationId},createdAt:tx.stamp});
 if(!await tx.commit(revision,hash,['shift-exchange','schedule-publish']))throw new AuthError(409,'Your access or shared data changed. Reload before deciding.');return {saved:true,revision:revision+1};
}
