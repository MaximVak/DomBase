import { and,desc,eq,sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import * as s from '../db/schema';
import { AuthError } from '../auth/http';
import { rateKey } from '../auth/crypto';
import { canonical,newRecordId } from './contract';
import type { Context,Database } from './context';
import type { WorkspaceTransaction } from './transaction';
import { selectNoticeRecipients,writePublicationNotices } from './publication-notices';
import { occupiedScheduleIntervals,openShiftIsFuture } from '../app/open-shifts-model';
import { offsetScheduleDate } from '../self/schedule-model';
import { exchangeStamp } from '../app/shift-exchanges-model';
import type { ExchangeRequest,ExchangeShift } from '../app/shift-exchanges-model';
export type StoredShift=typeof s.shifts.$inferSelect;
export type StoredExchange=typeof s.shiftExchangeRequests.$inferSelect;
export type ExchangeActor={account:{id:number;employeeId:number|null};guard:SQL};
export const activeExchange=sql`status IN ('pending','accepted')`;
export const exchangeEligible=(employeeId:unknown,roleId:unknown)=>sql`EXISTS (SELECT 1 FROM employees e JOIN employee_roles er ON er.employee_id=e.id JOIN roles r ON r.id=er.role_id JOIN departments d ON d.id=r.department_id WHERE e.id=${employeeId} AND e.active=1 AND e.terminated=0 AND er.active=1 AND er.role_id=${roleId} AND r.archived=0 AND d.archived=0)`;
export const employeeLogin=(employeeId:unknown)=>sql`EXISTS (SELECT 1 FROM accounts a WHERE a.employee_id=${employeeId} AND a.access_level='employee' AND a.login_enabled=1 AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL)`;
export function shiftFingerprint(row:StoredShift,secret:string){
 return rateKey(secret,canonical({id:row.id,employeeId:row.employeeId,roleId:row.roleId,roleName:row.roleName,date:row.date,start:row.startTime,end:row.endTime,station:row.station,notes:row.notes,shiftType:row.shiftType,color:row.color,publicationId:row.publicationId,archivedAt:row.archivedAt,version:row.version}));
}
export const publicExchangeShift=(row:StoredShift,role:string):ExchangeShift=>({id:row.id,employeeId:row.employeeId,roleId:row.roleId!,role:row.roleName||role,date:row.date,start:row.startTime,end:row.endTime,station:row.station,color:row.color});
export async function exchangeRevision(db:Database,guard:SQL){const[row]=await db.select().from(s.workforceState).where(and(eq(s.workforceState.id,1),guard)).limit(1);if(!row)throw new AuthError(401,'Sign in to continue.');return row.revision;}
export async function sameExchangeRevision(db:Database,guard:SQL,revision:number){if(await exchangeRevision(db,guard)!==revision)throw new AuthError(409,'Shared data changed. Reload shift requests.');}
export async function loadExchangeShift(db:Database,id:number,guard:SQL){const[row]=await db.select().from(s.shifts).where(and(eq(s.shifts.id,id),guard)).limit(1);if(!row)throw new AuthError(404,'Shift is unavailable.');return row;}
export async function requireExchangeShift(db:Database,row:StoredShift,employeeId:number,guard:SQL,now:number){
 if(row.employeeId!==employeeId||row.archivedAt||row.shiftType!=='work'||!row.publicationId)throw new AuthError(409,'Choose your current published work shift.');
 if(!openShiftIsFuture(row.date,row.startTime,now))throw new AuthError(400,'Shift requests must be for future work.');
 if(!await db.get(sql`SELECT 1 WHERE ${guard} AND ${exchangeEligible(employeeId,row.roleId)}`))throw new AuthError(409,'The employee or job assignment is no longer eligible.');
 if(await db.get(sql`SELECT 1 FROM clock_events WHERE shift_id=${row.id} LIMIT 1`))throw new AuthError(409,'An actual clock record is linked to this shift. Ask a manager to review it.');
}
export async function exchangeShiftLocked(db:Database,id:number,except:number|null=null){return !!await db.get(sql`SELECT 1 FROM shift_exchange_requests WHERE status IN ('pending','accepted') AND (source_shift_id=${id} OR offered_shift_id=${id}) AND id!=${except??-1} LIMIT 1`);}
export async function exchangeOverlap(db:Database,employeeId:number,shift:StoredShift,excluded:number[],guard:SQL){
 const rows=await db.select({date:s.shifts.date,start:s.shifts.startTime,end:s.shifts.endTime,shiftType:s.shifts.shiftType}).from(s.shifts).where(and(eq(s.shifts.employeeId,employeeId),sql`archived_at IS NULL AND date BETWEEN ${offsetScheduleDate(shift.date,-1)} AND ${offsetScheduleDate(shift.date,1)} AND id NOT IN (SELECT value FROM json_each(${JSON.stringify(excluded)}))`,guard)).limit(2001);
 if(rows.length>2000)throw new AuthError(503,'Too many shifts to check safely.');
 const start=Date.parse(`${shift.date}T${shift.startTime}:00Z`);let end=Date.parse(`${shift.date}T${shift.endTime}:00Z`);if(end<=start)end+=86400000;
 return occupiedScheduleIntervals(rows).some(row=>row.start<end&&start<row.end);
}
export async function requireExchangePair(db:Database,request:StoredExchange,source:StoredShift,recipientId:number,offered:StoredShift|null,guard:SQL,secret:string,now:number){
 await requireExchangeShift(db,source,request.requesterId,guard,now);
 if(shiftFingerprint(source,secret)!==request.sourceFingerprint)throw new AuthError(409,'The source shift changed. Ask for a new request.');
 if(!await db.get(sql`SELECT 1 WHERE ${guard} AND ${exchangeEligible(recipientId,source.roleId)} AND ${employeeLogin(recipientId)}`))throw new AuthError(409,'The teammate is no longer eligible for this job.');
 if(request.kind==='trade'){
  if(!offered||offered.id===source.id)throw new AuthError(400,'Choose your own published shift to trade.');
  await requireExchangeShift(db,offered,recipientId,guard,now);
  if(!await db.get(sql`SELECT 1 WHERE ${guard} AND ${exchangeEligible(request.requesterId,offered.roleId)} AND ${employeeLogin(request.requesterId)}`))throw new AuthError(409,'The requester cannot take this return job.');
 }else if(offered)throw new AuthError(400,'A cover request does not swap another shift.');
 const excluded=[source.id,...offered?[offered.id]:[]];
 if(await exchangeOverlap(db,recipientId,source,excluded,guard)||(offered&&await exchangeOverlap(db,request.requesterId,offered,excluded,guard)))throw new AuthError(409,'This would overlap published work or a day off.');
}
export function exchangeManagerScope(ctx:Context){
 const source=sql`(SELECT role_id FROM shifts WHERE id=${s.shiftExchangeRequests.sourceShiftId})`,offered=sql`(SELECT role_id FROM shifts WHERE id=${s.shiftExchangeRequests.offeredShiftId})`;
 return and(ctx.activeActor(),ctx.employeeFilter(s.shiftExchangeRequests.requesterId),sql`(${s.shiftExchangeRequests.selectedEmployeeId} IS NULL OR ${ctx.employeeFilter(s.shiftExchangeRequests.selectedEmployeeId)})`,ctx.roleFilter(sql`json_extract(${s.shiftExchangeRequests.sourceSnapshot},'$.roleId')`),ctx.roleFilter(source),sql`(${s.shiftExchangeRequests.offeredShiftId} IS NULL OR (${ctx.roleFilter(offered)} AND ${ctx.roleFilter(sql`json_extract(${s.shiftExchangeRequests.offeredSnapshot},'$.roleId')`)}))`)!;
}
export async function exchangeRequestPage(db:Database,guard:SQL,visible:SQL,secret:string,now:number,employeeId:number|null,cursor:number|null,history=true,requestId:number|null=null){
 let position=sql`1=1`;if(cursor){const[prior]=await db.select().from(s.shiftExchangeRequests).where(and(eq(s.shiftExchangeRequests.id,cursor),visible,guard)).limit(1);if(!prior)throw new AuthError(404,'Request history page is unavailable.');position=sql`(${s.shiftExchangeRequests.requestedAt}<${prior.requestedAt} OR (${s.shiftExchangeRequests.requestedAt}=${prior.requestedAt} AND ${s.shiftExchangeRequests.id}<${cursor}))`;}
 const rows=await db.select().from(s.shiftExchangeRequests).where(and(visible,guard,position,history?sql`1=1`:eq(s.shiftExchangeRequests.status,'accepted'),requestId?eq(s.shiftExchangeRequests.id,requestId):sql`1=1`)).orderBy(desc(s.shiftExchangeRequests.requestedAt),desc(s.shiftExchangeRequests.id)).limit(51);
 const ids=rows.flatMap(row=>[row.sourceShiftId,...row.offeredShiftId?[row.offeredShiftId]:[]]);
 const peopleIds=rows.flatMap(row=>[row.requesterId,...row.selectedEmployeeId?[row.selectedEmployeeId]:[]]);
 const [shifts,people,invitations]=await db.batch([
  db.select().from(s.shifts).where(and(sql`id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,guard)),
  db.select({id:s.employees.id,name:s.employees.name}).from(s.employees).where(and(sql`id IN (SELECT value FROM json_each(${JSON.stringify(peopleIds)}))`,guard)),
  db.select().from(s.shiftExchangeInvitations).where(and(eq(s.shiftExchangeInvitations.employeeId,employeeId??-1),sql`request_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map(row=>row.id))}))`,guard)),
 ]);
 const requests:ExchangeRequest[]=rows.slice(0,50).map(row=>{
  const source=shifts.find(shift=>shift.id===row.sourceShiftId),offered=shifts.find(shift=>shift.id===row.offeredShiftId),invitation=invitations.find(invite=>invite.requestId===row.id);
  const participant=employeeId===null||employeeId===row.requesterId||employeeId===row.selectedEmployeeId;
  return {id:row.id,kind:row.kind,status:row.status,version:row.version,requesterId:row.requesterId,requester:people.find(p=>p.id===row.requesterId)?.name??'Team member',selectedEmployeeId:participant?row.selectedEmployeeId:null,selectedEmployee:participant?people.find(p=>p.id===row.selectedEmployeeId)?.name??null:null,source:row.sourceSnapshot,offered:participant?row.offeredSnapshot:null,requestedAt:exchangeStamp(row.requestedAt),acceptedAt:row.acceptedAt?exchangeStamp(row.acceptedAt):null,decidedAt:row.decidedAt?exchangeStamp(row.decidedAt):null,reason:participant?row.reason:row.status==='pending'?'':'This request is closed.',...invitation?{invitation:{id:invitation.id,status:invitation.status,version:invitation.version}}:{},stale:!!(['pending','accepted'].includes(row.status)&&(!source||shiftFingerprint(source,secret)!==row.sourceFingerprint||!openShiftIsFuture(source.date,source.startTime,now)||(row.offeredShiftId&&(!offered||shiftFingerprint(offered,secret)!==row.offeredFingerprint||!openShiftIsFuture(offered.date,offered.startTime,now)))))};
 });
 return {requests,nextCursor:rows.length>50?rows[49].id:null};
}
export async function notifyExchange(db:Database,tx:WorkspaceTransaction,guard:SQL,ids:number[],emailEnabled:boolean,date:string){
 const[settings]=await db.select().from(s.locationSettings).where(and(eq(s.locationSettings.businessId,1),guard)).limit(1);if(!settings)throw new AuthError(401,'Sign in to continue.');
 const[last]=await db.select({version:s.schedulePublications.version}).from(s.schedulePublications).orderBy(desc(s.schedulePublications.version)).limit(1);
 const recipients=await selectNoticeRecipients(db,{activeActor:()=>guard,employeeFilter:()=>sql`1=1`},settings.notifyScheduleChanges,{inApp:true,email:emailEnabled,event:"shiftExchange"},[...new Set(ids)]),id=newRecordId();
 tx.insert(s.schedulePublications,{id,version:(last?.version??0)+1,publishedByAccountId:tx.ctx.account.id,publishedAt:tx.stamp,noticeType:'schedule',shiftExchange:true,periodStart:date,periodEnd:date,notifyMode:'changed',notifyInApp:true,notifyEmail:emailEnabled,scopeDepartments:[]});
 writePublicationNotices(tx,id,recipients,{title:'Shift trade or cover request updated',detail:'A shift request needs your attention or has a new decision. Open My schedule to review your requests.'});
 return id;
}
export async function exchangeInvalidations(db:Database,guard:SQL,shiftIds:number[],except:number|null=null){
 const rows=shiftIds.length?await db.select().from(s.shiftExchangeRequests).where(and(sql`${s.shiftExchangeRequests.status} IN ('pending','accepted') AND (${s.shiftExchangeRequests.sourceShiftId} IN (SELECT value FROM json_each(${JSON.stringify(shiftIds)})) OR ${s.shiftExchangeRequests.offeredShiftId} IN (SELECT value FROM json_each(${JSON.stringify(shiftIds)})))`,sql`${s.shiftExchangeRequests.id}!=${except??-1}`,guard)).limit(2001):[];
 if(rows.length>2000)throw new AuthError(503,'Too many related requests to close safely.');
 const invites=rows.length?await db.select().from(s.shiftExchangeInvitations).where(and(sql`request_id IN (SELECT value FROM json_each(${JSON.stringify(rows.map(row=>row.id))}))`,guard)).limit(10001):[];
 if(invites.length>10000)throw new AuthError(503,'Too many request recipients to close safely.');
 return {rows,invites,employeeIds:[...new Set([...rows.map(row=>row.requesterId),...invites.map(row=>row.employeeId)])]};
}
export function writeExchangeInvalidations(tx:WorkspaceTransaction,plan:Awaited<ReturnType<typeof exchangeInvalidations>>){
 tx.updateRows(s.shiftExchangeRequests,plan.rows.map(row=>({id:row.id,status:'cancelled',version:row.version+1,decidedAt:tx.stamp,decidedByAccountId:tx.ctx.account.id,reason:'A published shift changed or was removed. Create a new request for its current version.'})),'id',sql`status IN ('pending','accepted') AND version=json_extract(entry.value,'$.version')-1`);
 tx.updateRows(s.shiftExchangeInvitations,plan.invites.filter(row=>row.status==='pending'||row.status==='accepted').map(row=>({id:row.id,status:'closed',version:row.version+1,respondedAt:tx.stamp})),'id',sql`version=json_extract(entry.value,'$.version')-1`);
 tx.insertRows(s.auditLog,plan.rows.map(row=>({actorAccountId:tx.ctx.account.id,employeeId:row.requesterId,action:'schedule.exchange_cancelled',entityType:'shift-exchange',entityId:String(row.id),metadata:{sourceShiftId:row.sourceShiftId,offeredShiftId:row.offeredShiftId},createdAt:tx.stamp})));
}
export function exchangeNoConflict(employeeId:unknown,shift:StoredShift,excluded:number[]){
 return sql`NOT EXISTS (SELECT 1 FROM shifts scheduled WHERE scheduled.employee_id=${employeeId} AND scheduled.archived_at IS NULL AND scheduled.id NOT IN (SELECT value FROM json_each(${JSON.stringify(excluded)})) AND julianday(scheduled.date||'T'||CASE WHEN scheduled.shift_type='day_off' THEN '00:00' ELSE scheduled.start_time END)<(julianday(${shift.date+'T'+shift.endTime})+${shift.endTime<=shift.startTime?1:0}) AND julianday(scheduled.date||'T'||CASE WHEN scheduled.shift_type='day_off' THEN '00:00' ELSE scheduled.end_time END)+(CASE WHEN scheduled.shift_type='day_off' OR scheduled.end_time<=scheduled.start_time THEN 1 ELSE 0 END)>julianday(${shift.date+'T'+shift.startTime}))`;
}
export function exchangeShiftUnchanged(row:StoredShift){return sql`id=${row.id} AND employee_id=${row.employeeId} AND role_id IS ${row.roleId} AND publication_id IS ${row.publicationId} AND version=${row.version} AND archived_at IS NULL AND date=${row.date} AND start_time=${row.startTime} AND end_time=${row.endTime} AND station=${row.station} AND notes=${row.notes} AND color=${row.color} AND shift_type=${row.shiftType} AND role_name=${row.roleName}`;}
