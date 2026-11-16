import { and,eq,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { AuthError } from '../auth/http';
import { rateKey,tokenIsValid } from '../auth/crypto';
import { canonical,newRecordId } from '../workforce/contract';
import * as v from '../workforce/validation';
import type { Database } from '../workforce/context';
import type { SchedulePreferenceContext } from './schedule-notifications';
import { WorkspaceTransaction } from '../workforce/transaction';
import { occupiedScheduleIntervals,openShiftConflicts,openShiftIsFuture } from '../app/open-shifts-model';
import { offsetScheduleDate } from './schedule-model';
import { scheduleWeekStart } from '../app/schedule-estimates';
import { exchangeEligible,employeeLogin,exchangeRevision,sameExchangeRevision,loadExchangeShift,requireExchangeShift,exchangeShiftLocked,shiftFingerprint,publicExchangeShift,requireExchangePair,exchangeRequestPage,notifyExchange,exchangeNoConflict } from '../workforce/shift-exchanges-shared';
import type { ExchangeKind } from '../app/shift-exchanges-model';
const ownVisible=(employeeId:number)=>sql`(${s.shiftExchangeRequests.requesterId}=${employeeId} OR EXISTS (SELECT 1 FROM shift_exchange_invitations invite WHERE invite.request_id=${s.shiftExchangeRequests.id} AND invite.employee_id=${employeeId}))`;
async function ownShift(db:Database,ctx:SchedulePreferenceContext,id:number,now:number){const row=await loadExchangeShift(db,id,ctx.guard);if(row.employeeId!==ctx.account.employeeId)throw new AuthError(404,'Your published shift is unavailable.');await requireExchangeShift(db,row,ctx.account.employeeId!,ctx.guard,now);return row;}
async function ownRequest(db:Database,ctx:SchedulePreferenceContext,id:number){const[row]=await db.select().from(s.shiftExchangeRequests).where(and(eq(s.shiftExchangeRequests.id,id),ownVisible(ctx.account.employeeId!),ctx.guard)).limit(1);if(!row)throw new AuthError(404,'Your request is unavailable.');return row;}
export async function exchangeCandidates(db:Database,ctx:SchedulePreferenceContext,id:number,kind:ExchangeKind,now:number){
 const source=await ownShift(db,ctx,id,now);if(await exchangeShiftLocked(db,id))throw new AuthError(409,'This shift already has an active trade or cover request.');
 const people=await db.select({id:s.employees.id,name:s.employees.name}).from(s.employees).where(and(sql`${s.employees.id}!=${ctx.account.employeeId}`,exchangeEligible(s.employees.id,source.roleId),employeeLogin(s.employees.id),ctx.guard)).orderBy(s.employees.name,s.employees.id).limit(2001);
 if(people.length>2000)throw new AuthError(503,'Too many teammates to invite safely.');
 let eligible=people;if(kind==='cover'){
  const occupied=await db.select({employeeId:s.shifts.employeeId,date:s.shifts.date,start:s.shifts.startTime,end:s.shifts.endTime,shiftType:s.shifts.shiftType}).from(s.shifts).where(and(sql`${s.shifts.employeeId} IN (SELECT value FROM json_each(${JSON.stringify(people.map(p=>p.id))})) AND archived_at IS NULL AND date BETWEEN ${offsetScheduleDate(source.date,-1)} AND ${offsetScheduleDate(source.date,1)}`,ctx.guard)).limit(10001);
  if(occupied.length>10000)throw new AuthError(503,'Too much scheduled work to check safely.');
  eligible=people.filter(person=>!openShiftConflicts({date:source.date,start:source.startTime,end:source.endTime},occupiedScheduleIntervals(occupied.filter(row=>row.employeeId===person.id))));
 }
 const[role]=await db.select({name:s.roles.name}).from(s.roles).where(eq(s.roles.id,source.roleId!));
 return {source,publicSource:publicExchangeShift(source,role?.name??''),people:eligible};
}
export async function readMyExchanges(db:Database,ctx:SchedulePreferenceContext,url:URL,secret:string,now:number){
 const allowed=['date','cursor','sourceShiftId','kind','requestId'];if([...url.searchParams.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>url.searchParams.getAll(key).length>1))throw new AuthError(400,'Invalid shift request filters; employee selectors are not allowed.');
 const revision=await exchangeRevision(db,ctx.guard),base={revision,contextToken:ctx.contextToken};
 const date=url.searchParams.has('date')?v.date(url.searchParams.get('date')):null;
 if(url.searchParams.has('sourceShiftId')){
  if(url.searchParams.has('cursor')||url.searchParams.has('requestId')||date)throw new AuthError(400,'Choose one request operation.');
  const kind=v.oneOf(url.searchParams.get('kind'),['cover','trade']),data=await exchangeCandidates(db,ctx,v.integer(Number(url.searchParams.get('sourceShiftId'))),kind,now);await sameExchangeRevision(db,ctx.guard,revision);
  return {...base,kind,source:data.publicSource,people:data.people};
 }
 if(url.searchParams.has('kind'))throw new AuthError(400,'Choose a source shift first.');
 if(url.searchParams.has('requestId')){
  if(url.searchParams.has('cursor'))throw new AuthError(400,'Choose one request operation.');
  const parent=await ownRequest(db,ctx,v.integer(Number(url.searchParams.get('requestId'))));
  const[invite]=await db.select().from(s.shiftExchangeInvitations).where(and(eq(s.shiftExchangeInvitations.requestId,parent.id),eq(s.shiftExchangeInvitations.employeeId,ctx.account.employeeId!),ctx.guard)).limit(1);
  if(parent.kind!=='trade'||parent.status!=='pending'||invite?.status!=='pending')throw new AuthError(409,'This request is no longer waiting for your trade offer.');
  const source=await loadExchangeShift(db,parent.sourceShiftId,ctx.guard);await requireExchangeShift(db,source,parent.requesterId,ctx.guard,now);if(shiftFingerprint(source,secret)!==parent.sourceFingerprint)throw new AuthError(409,'The requested shift changed.');
  const[settings]=await db.select({weekStart:s.locationSettings.workWeekStart}).from(s.locationSettings).where(eq(s.locationSettings.businessId,1));
  const startDate=scheduleWeekStart(date??source.date,settings?.weekStart??1),endDate=offsetScheduleDate(startDate,6);
  const rows=await db.select().from(s.shifts).where(and(eq(s.shifts.employeeId,ctx.account.employeeId!),sql`archived_at IS NULL AND shift_type='work' AND publication_id IS NOT NULL AND date BETWEEN ${startDate} AND ${endDate}`,exchangeEligible(parent.requesterId,s.shifts.roleId),exchangeEligible(ctx.account.employeeId,s.shifts.roleId),ctx.guard)).orderBy(s.shifts.date,s.shifts.startTime,s.shifts.id).limit(2001);
  if(rows.length>2000)throw new AuthError(503,'Too many return shifts to review safely.');
  if(!await db.get(sql`SELECT 1 WHERE ${ctx.guard} AND ${exchangeEligible(ctx.account.employeeId,source.roleId)} AND ${employeeLogin(ctx.account.employeeId)} AND ${employeeLogin(parent.requesterId)}`))throw new AuthError(409,'A participant is no longer eligible. Ask for manager review.');
  const ids=rows.map(row=>row.id);
  const [roles,calendar,punches,locks]=await db.batch([
   db.select({id:s.roles.id,name:s.roles.name}).from(s.roles).where(and(sql`id IN (SELECT value FROM json_each(${JSON.stringify(rows.map(row=>row.roleId))}))`,ctx.guard)),
   db.select({id:s.shifts.id,employeeId:s.shifts.employeeId,date:s.shifts.date,start:s.shifts.startTime,end:s.shifts.endTime,shiftType:s.shifts.shiftType}).from(s.shifts).where(and(sql`employee_id IN (${ctx.account.employeeId},${parent.requesterId}) AND archived_at IS NULL AND (date BETWEEN ${offsetScheduleDate(startDate,-1)} AND ${offsetScheduleDate(endDate,1)} OR date BETWEEN ${offsetScheduleDate(source.date,-1)} AND ${offsetScheduleDate(source.date,1)})`,ctx.guard)).limit(10001),
   db.select({shiftId:s.clockEvents.shiftId}).from(s.clockEvents).where(and(sql`shift_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,ctx.guard)).limit(10001),
   db.select({source:s.shiftExchangeRequests.sourceShiftId,offered:s.shiftExchangeRequests.offeredShiftId}).from(s.shiftExchangeRequests).where(and(sql`id!=${parent.id} AND status IN ('pending','accepted') AND (source_shift_id IN (SELECT value FROM json_each(${JSON.stringify(ids)})) OR offered_shift_id IN (SELECT value FROM json_each(${JSON.stringify(ids)})))`,ctx.guard)).limit(4001),
  ]);
  if(calendar.length>10000||punches.length>10000||locks.length>4000)throw new AuthError(503,'Too much scheduled work to review safely.');
  const locked=new Set(locks.flatMap(row=>[row.source,row.offered])),recorded=new Set(punches.map(row=>row.shiftId));
  const shifts=rows.filter(row=>openShiftIsFuture(row.date,row.startTime,now)).map(row=>{
   const excluded=new Set([source.id,row.id]);const conflicts=(employeeId:number,shift:{date:string;start:string;end:string})=>openShiftConflicts(shift,occupiedScheduleIntervals(calendar.filter(other=>other.employeeId===employeeId&&!excluded.has(other.id))));
   const unavailable=locked.has(row.id)?'This shift already has an active request.':recorded.has(row.id)?'An actual clock record is linked to this shift. Ask a manager to review it.':conflicts(ctx.account.employeeId!,{date:source.date,start:source.startTime,end:source.endTime})||conflicts(parent.requesterId,{date:row.date,start:row.startTime,end:row.endTime})?'This would overlap published work or a day off.':'';
   return {...publicExchangeShift(row,roles.find(role=>role.id===row.roleId)?.name??''),canOffer:!unavailable,unavailable};
  });
  await sameExchangeRevision(db,ctx.guard,revision);return {...base,requestId:parent.id,version:parent.version,startDate,endDate,shifts};
 }
 const page=await exchangeRequestPage(db,ctx.guard,ownVisible(ctx.account.employeeId!),secret,now,ctx.account.employeeId!,url.searchParams.has('cursor')?v.integer(Number(url.searchParams.get('cursor'))):null);await sameExchangeRevision(db,ctx.guard,revision);return {...base,employeeId:ctx.account.employeeId!,...page};
}
export async function saveMyExchange(db:Database,ctx:SchedulePreferenceContext,body:Record<string,unknown>,secret:string,now:number,emailEnabled=false){
 const action=v.oneOf(body.action,['create','accept','decline','cancel']);
 v.keys(body,['id','contextToken','revision','action',...(action==='create'?['sourceShiftId','kind','recipientIds']:['requestId','version',...(action==='accept'?['offeredShiftId']:[])])]);
 if(!tokenIsValid(body.id))throw new AuthError(400,'Invalid save identifier.');if(body.contextToken!==ctx.contextToken)throw new AuthError(409,'Your sign-in changed. Reload shift requests.');
 const revision=v.integer(body.revision,0),current=await exchangeRevision(db,ctx.guard),hash=`shift-exchange:${rateKey(secret,canonical(body))}`;
 const[prior]=await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id,body.id),ctx.guard)).limit(1);if(prior){if(prior.accountId!==ctx.account.id||prior.bodyHash!==hash)throw new AuthError(409,'Save identifier already in use.');return {saved:true,revision:prior.revision};}
 if(revision!==current)throw new AuthError(409,'Shared data changed. Reload before sending a request.');
 let guard=ctx.guard;const tx=new WorkspaceTransaction(db,{account:ctx.account,activeActor:()=>guard},body.id,new Date(now).toISOString());let notify:number[]=[],date='';
 if(action==='create'){
  const kind=v.oneOf(body.kind,['cover','trade']),catalog=await exchangeCandidates(db,ctx,v.integer(body.sourceShiftId),kind,now),source=catalog.source;
  const ids=body.recipientIds==='all'?catalog.people.map(p=>p.id):v.list(body.recipientIds,2000).map(id=>v.integer(id));
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!catalog.people.some(p=>p.id===id)))throw new AuthError(400,'Choose eligible teammates, or everyone eligible.');
  const[count]=await db.select({n:sql<number>`count(*)`}).from(s.shiftExchangeRequests).where(sql`requester_id=${ctx.account.employeeId} AND status IN ('pending','accepted')`);if(count.n>=50)throw new AuthError(400,'Resolve existing requests before creating more.');
  const id=newRecordId();guard=sql`${guard} AND ${exchangeEligible(ctx.account.employeeId,source.roleId)}`;
  tx.insert(s.shiftExchangeRequests,{id,kind,requesterId:ctx.account.employeeId,sourceShiftId:source.id,sourceFingerprint:shiftFingerprint(source,secret),sourceSnapshot:catalog.publicSource,requestedAt:tx.stamp});
  tx.insertRows(s.shiftExchangeInvitations,ids.map(employeeId=>({id:newRecordId(),requestId:id,employeeId})),sql`${exchangeEligible(sql`json_extract(entry.value,'$.employeeId')`,source.roleId)} AND ${employeeLogin(sql`json_extract(entry.value,'$.employeeId')`)} ${kind==='cover'?sql`AND ${exchangeNoConflict(sql`json_extract(entry.value,'$.employeeId')`,source,[source.id])}`:sql``}`);
  tx.insert(s.auditLog,{actorAccountId:ctx.account.id,employeeId:ctx.account.employeeId,action:'schedule.exchange_requested',entityType:'shift-exchange',entityId:String(id),metadata:{kind,sourceShiftId:source.id,recipientCount:ids.length},createdAt:tx.stamp});notify=ids;date=source.date;
 }else{
  const parent=await ownRequest(db,ctx,v.integer(body.requestId));if(parent.version!==v.integer(body.version))throw new AuthError(409,'This request changed. Reload before responding.');
  const invites=await db.select().from(s.shiftExchangeInvitations).where(and(eq(s.shiftExchangeInvitations.requestId,parent.id),ctx.guard)).limit(2001);if(invites.length>2000)throw new AuthError(503,'Too many request recipients.');
  date=parent.sourceSnapshot.date;
  if(action==='cancel'){
   if(parent.requesterId!==ctx.account.employeeId)throw new AuthError(404,'Your outgoing request is unavailable.');if(parent.status!=='pending')throw new AuthError(409,'After teammate acceptance, a manager must decide the request.');
   tx.update(s.shiftExchangeRequests,{status:'cancelled',version:parent.version+1,decidedAt:tx.stamp,reason:'Cancelled by requester.'},sql`id=${parent.id} AND status='pending' AND version=${parent.version}`);
   tx.updateRows(s.shiftExchangeInvitations,invites.filter(row=>row.status==='pending').map(row=>({id:row.id,status:'closed',version:row.version+1,respondedAt:tx.stamp})),'id',sql`status='pending' AND version=json_extract(entry.value,'$.version')-1`);notify=invites.filter(row=>row.status==='pending').map(row=>row.employeeId);
  }else{
   const own=invites.find(row=>row.employeeId===ctx.account.employeeId);if(!own)throw new AuthError(404,'Your invitation is unavailable.');if(own.status!=='pending'||parent.status!=='pending')throw new AuthError(409,'This request is no longer waiting for your response.');
   if(action==='decline'){
    const last=invites.filter(row=>row.status==='pending').length===1;
    tx.update(s.shiftExchangeInvitations,{status:'declined',version:own.version+1,respondedAt:tx.stamp},sql`id=${own.id} AND status='pending' AND version=${own.version}`);
    tx.update(s.shiftExchangeRequests,{version:parent.version+1,...last?{status:'declined',decidedAt:tx.stamp,reason:'All invited teammates declined.'}:{}},sql`id=${parent.id} AND status='pending' AND version=${parent.version}`);notify=[parent.requesterId];
   }else{
    const source=await loadExchangeShift(db,parent.sourceShiftId,ctx.guard),offered=body.offeredShiftId===undefined||body.offeredShiftId===null?null:await ownShift(db,ctx,v.integer(body.offeredShiftId),now);
    await requireExchangePair(db,parent,source,ctx.account.employeeId!,offered,ctx.guard,secret,now);if(offered&&await exchangeShiftLocked(db,offered.id,parent.id))throw new AuthError(409,'The return shift already has an active request.');
    guard=sql`${guard} AND ${exchangeEligible(ctx.account.employeeId,source.roleId)} AND ${exchangeEligible(parent.requesterId,source.roleId)} ${offered?sql`AND ${exchangeEligible(parent.requesterId,offered.roleId)}`:sql``}`;
    const excluded=[source.id,...offered?[offered.id]:[]];guard=sql`${guard} AND ${exchangeNoConflict(ctx.account.employeeId,source,excluded)} ${offered?sql`AND ${exchangeNoConflict(parent.requesterId,offered,excluded)}`:sql``}`;
    const[role]=offered?await db.select().from(s.roles).where(eq(s.roles.id,offered.roleId!)):[];
    tx.update(s.shiftExchangeRequests,{status:'accepted',version:parent.version+1,selectedEmployeeId:ctx.account.employeeId,offeredShiftId:offered?.id??null,offeredFingerprint:offered?shiftFingerprint(offered,secret):null,offeredSnapshot:offered?publicExchangeShift(offered,role?.name??''):null,acceptedAt:tx.stamp},sql`id=${parent.id} AND status='pending' AND version=${parent.version}`);
    tx.updateRows(s.shiftExchangeInvitations,invites.filter(row=>row.status==='pending').map(row=>({id:row.id,status:row.id===own.id?'accepted':'closed',version:row.version+1,respondedAt:tx.stamp})),'id',sql`status='pending' AND version=json_extract(entry.value,'$.version')-1`);notify=[parent.requesterId,...invites.map(row=>row.employeeId)];
   }
  }
  tx.insert(s.auditLog,{actorAccountId:ctx.account.id,employeeId:ctx.account.employeeId,action:`schedule.exchange_${action}`,entityType:'shift-exchange',entityId:String(parent.id),metadata:{kind:parent.kind,sourceShiftId:parent.sourceShiftId},createdAt:tx.stamp});
 }
 await notifyExchange(db,tx,guard,notify,emailEnabled,date);
 if(!await tx.commit(revision,hash,['shift-exchange']))throw new AuthError(409,'Your access or shared data changed. Reload requests.');return {saved:true,revision:revision+1};
}
