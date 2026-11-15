import { and,desc,eq,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { AuthError } from '../auth/http';
import { rateKey,tokenIsValid } from '../auth/crypto';
import { canonical,newRecordId } from '../workforce/contract';
import type { Database } from '../workforce/context';
import type { SchedulePreferenceContext } from './schedule-notifications';
import { WorkspaceTransaction } from '../workforce/transaction';
import * as v from '../workforce/validation';
import { openShiftIsFuture, occupiedScheduleIntervals, openShiftConflicts } from '../app/open-shifts-model';
import { scheduleWeekStart } from '../app/schedule-estimates';
import { offsetScheduleDate } from './schedule-model';
export const eligibleForOpen = (employeeId:number,roleId:unknown) => sql`EXISTS (SELECT 1 FROM employees e JOIN employee_roles er ON er.employee_id=e.id JOIN roles r ON r.id=er.role_id JOIN departments d ON d.id=r.department_id LEFT JOIN employee_settings es ON es.employee_id=e.id WHERE e.id=${employeeId} AND e.active=1 AND e.terminated=0 AND COALESCE(es.eligible_for_open_shifts,1)=1 AND er.active=1 AND er.role_id=${roleId} AND r.archived=0 AND d.archived=0)`;
export async function ownOpenMetadata(db:Database,ctx:SchedulePreferenceContext){
 const [row]=await db.select({revision:s.workforceState.revision,weekStart:s.locationSettings.workWeekStart,eligible:s.employeeSettings.eligibleForOpenShifts}).from(s.employees).innerJoin(s.workforceState,eq(s.workforceState.id,1)).innerJoin(s.locationSettings,eq(s.locationSettings.businessId,1)).leftJoin(s.employeeSettings,eq(s.employeeSettings.employeeId,s.employees.id)).where(and(eq(s.employees.id,ctx.account.employeeId??-1),ctx.guard)).limit(1);
 if(!row)throw new AuthError(401,'Sign in to continue.');return row;
}
export async function openShiftOverlap(db:Database,employeeId:number,shift:{id:number;date:string;start:string;end:string}){
 const existing=await db.select({id:s.shifts.id,employeeId:s.shifts.employeeId,date:s.shifts.date,start:s.shifts.startTime,end:s.shifts.endTime,shiftType:s.shifts.shiftType}).from(s.shifts).where(and(eq(s.shifts.employeeId,employeeId),sql`${s.shifts.date} BETWEEN ${offsetScheduleDate(shift.date,-1)} AND ${shift.date}`,sql`${s.shifts.archivedAt} IS NULL`)).limit(2001);
 if(existing.length>2000)throw new AuthError(503,'Too many shifts on this date to check safely.');return openShiftConflicts(shift,occupiedScheduleIntervals(existing));
}
export async function readOwnOpenShifts(db:Database,ctx:SchedulePreferenceContext,url:URL,now:number){
 if([...url.searchParams.keys()].some(key=>!['date','cursor'].includes(key))||['date','cursor'].some(key=>url.searchParams.getAll(key).length>1))throw new AuthError(400,'Choose a schedule date only; employee selectors are not allowed.');
 const meta=await ownOpenMetadata(db,ctx),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),startDate=scheduleWeekStart(v.date(url.searchParams.get('date')??today),meta.weekStart),endDate=offsetScheduleDate(startDate,6),employeeId=ctx.account.employeeId!;
 let cursor=sql`1=1`;if(url.searchParams.has('cursor')){const id=v.integer(Number(url.searchParams.get('cursor')));const [prior]=await db.select().from(s.openShiftClaims).where(and(eq(s.openShiftClaims.id,id),eq(s.openShiftClaims.employeeId,employeeId),ctx.guard)).limit(1);if(!prior)throw new AuthError(404,'Request history page is unavailable.');cursor=sql`(julianday(${s.openShiftClaims.requestedAt})<julianday(${prior.requestedAt}) OR (julianday(${s.openShiftClaims.requestedAt})=julianday(${prior.requestedAt}) AND ${s.openShiftClaims.id}<${id}))`;}
 const [open,claims]=await db.batch([
  db.select({id:s.openShifts.id,roleId:s.openShifts.roleId,role:s.roles.name,departmentId:s.roles.departmentId,date:s.openShifts.date,start:s.openShifts.startTime,end:s.openShifts.endTime,station:s.openShifts.station,color:s.openShifts.color,version:s.openShifts.version}).from(s.openShifts).innerJoin(s.roles,eq(s.roles.id,s.openShifts.roleId)).where(and(sql`${s.openShifts.archivedAt} IS NULL AND ${s.openShifts.filledShiftId} IS NULL`,sql`${s.openShifts.date} BETWEEN ${startDate} AND ${endDate}`,eligibleForOpen(employeeId,s.openShifts.roleId),ctx.guard)).orderBy(s.openShifts.date,s.openShifts.startTime,s.openShifts.id).limit(2001),
  db.select({id:sql<number>`${s.openShiftClaims.id}`.as('claim_record_id'),openShiftId:s.openShiftClaims.openShiftId,employeeId:s.openShiftClaims.employeeId,status:s.openShiftClaims.status,version:s.openShiftClaims.version,openVersion:s.openShiftClaims.openVersion,requestedAt:s.openShiftClaims.requestedAt,decidedAt:s.openShiftClaims.decidedAt,reason:s.openShiftClaims.reason,shift:{id:sql<number>`${s.openShifts.id}`.as('shift_record_id'),role:s.roles.name,departmentId:s.roles.departmentId,date:s.openShifts.date,start:s.openShifts.startTime,end:s.openShifts.endTime,station:s.openShifts.station,color:s.openShifts.color}}).from(s.openShiftClaims).innerJoin(s.openShifts,eq(s.openShifts.id,s.openShiftClaims.openShiftId)).innerJoin(s.roles,eq(s.roles.id,s.openShifts.roleId)).where(and(eq(s.openShiftClaims.employeeId,employeeId),ctx.guard,cursor)).orderBy(desc(sql`julianday(${s.openShiftClaims.requestedAt})`),desc(s.openShiftClaims.id)).limit(51),
 ]);
 if(open.length>2000)throw new AuthError(503,'Too many open shifts. Ask a manager to narrow this week.');
 const pending=await db.select({openShiftId:s.openShiftClaims.openShiftId,status:s.openShiftClaims.status,openVersion:s.openShiftClaims.openVersion}).from(s.openShiftClaims).where(and(eq(s.openShiftClaims.employeeId,employeeId),sql`${s.openShiftClaims.openShiftId} IN (SELECT value FROM json_each(${JSON.stringify(open.map(row=>row.id))}))`,sql`${s.openShiftClaims.status} IN ('pending','declined')`,ctx.guard)).limit(2001);
 if(pending.length>2000)throw new AuthError(503,'Too many request records to review safely.');
 const existing=await db.select({id:s.shifts.id,employeeId:s.shifts.employeeId,date:s.shifts.date,start:s.shifts.startTime,end:s.shifts.endTime,shiftType:s.shifts.shiftType}).from(s.shifts).where(and(eq(s.shifts.employeeId,employeeId),sql`${s.shifts.archivedAt} IS NULL AND ${s.shifts.date} BETWEEN ${offsetScheduleDate(startDate,-1)} AND ${endDate}`,ctx.guard)).limit(2001);
 if(existing.length>2000)throw new AuthError(503,'Too many assigned shifts to check safely.');
 const occupied=occupiedScheduleIntervals(existing);
 const rows=[];for(const row of open){if(!openShiftIsFuture(row.date,row.start,now))continue;const prior=pending.find(claim=>claim.openShiftId===row.id&&(claim.status==='pending'||claim.openVersion===row.version));const conflict=openShiftConflicts(row,occupied);const unavailable=prior?prior.status==='pending'?'Your request is pending manager approval.':'Your request for this version was declined.':conflict?'This conflicts with your published schedule.':'';rows.push({...row,canClaim:!unavailable,unavailable});}
 const current=await ownOpenMetadata(db,ctx);if(current.revision!==meta.revision)throw new AuthError(409,'Shared data changed. Reload open shifts.');
 return {revision:meta.revision,contextToken:ctx.contextToken,eligible:meta.eligible!==false,startDate,endDate,open:rows,claims:claims.slice(0,50),nextCursor:claims.length>50?claims[49].id:null};
}
export async function saveOwnOpenClaim(db:Database,ctx:SchedulePreferenceContext,body:Record<string,unknown>,secret:string,now:number){
 v.keys(body,['id','contextToken','revision','action','openShiftId','openVersion','claimId','claimVersion']);if(!tokenIsValid(body.id))throw new AuthError(400,'Invalid save identifier.');if(body.contextToken!==ctx.contextToken)throw new AuthError(409,'Your sign-in changed. Reload open shifts.');
 const action=v.oneOf(body.action,['claim','withdraw']),revision=v.integer(body.revision,0),meta=await ownOpenMetadata(db,ctx),hash=`open-claim:${rateKey(secret,canonical(body))}`;
 const [prior]=await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id,body.id),ctx.guard)).limit(1);if(prior){if(prior.accountId!==ctx.account.id||prior.bodyHash!==hash)throw new AuthError(409,'Save identifier already in use.');return {saved:true,revision:prior.revision};}
 if(meta.revision!==revision)throw new AuthError(409,'Shared data changed. Reload before submitting.');
 const tx=new WorkspaceTransaction(db,{account:ctx.account,activeActor:()=>ctx.guard},body.id,new Date(now).toISOString()),employeeId=ctx.account.employeeId!;
 if(action==='claim'){
  if(body.claimId!==undefined||body.claimVersion!==undefined)throw new AuthError(400,'Claiming does not accept another request.');
  const openShiftId=v.integer(body.openShiftId),openVersion=v.integer(body.openVersion);const [open]=await db.select().from(s.openShifts).where(and(eq(s.openShifts.id,openShiftId),eligibleForOpen(employeeId,s.openShifts.roleId),ctx.guard)).limit(1);
  if(!open||open.archivedAt||open.filledShiftId)throw new AuthError(404,'This open shift is no longer available.');if(open.version!==openVersion)throw new AuthError(409,'This open shift changed. Reload before requesting it.');if(!openShiftIsFuture(open.date,open.startTime,now))throw new AuthError(400,'This open shift has already started.');
  if(await openShiftOverlap(db,employeeId,{id:-1,date:open.date,start:open.startTime,end:open.endTime}))throw new AuthError(409,'This conflicts with your published schedule.');
  const priorRequest=await db.get(sql`SELECT 1 FROM open_shift_claims WHERE open_shift_id=${open.id} AND employee_id=${employeeId} AND (status='pending' OR (status='declined' AND open_version=${open.version})) AND ${ctx.guard} LIMIT 1`);if(priorRequest)throw new AuthError(409,'You already have a pending or declined request for this version.');
  const id=newRecordId();tx.insert(s.openShiftClaims,{id,openShiftId,employeeId,openVersion,status:'pending',requestedAt:tx.stamp},sql`${eligibleForOpen(employeeId,open.roleId)} AND EXISTS (SELECT 1 FROM open_shifts WHERE id=${openShiftId} AND version=${openVersion} AND filled_shift_id IS NULL AND archived_at IS NULL)`);tx.insert(s.auditLog,{actorAccountId:ctx.account.id,employeeId,action:'schedule.open_shift_claimed',entityType:'open-shift-claim',entityId:String(id),metadata:{openShiftId},createdAt:tx.stamp});
 }else{
  if(body.openShiftId!==undefined||body.openVersion!==undefined)throw new AuthError(400,'Withdrawing accepts your request only.');const id=v.integer(body.claimId),version=v.integer(body.claimVersion);
  const [own]=await db.select().from(s.openShiftClaims).where(and(eq(s.openShiftClaims.id,id),eq(s.openShiftClaims.employeeId,employeeId),ctx.guard)).limit(1);if(!own)throw new AuthError(404,'Request is unavailable.');if(own.status!=='pending'||own.version!==version)throw new AuthError(409,'This request changed. Reload before withdrawing.');
  tx.update(s.openShiftClaims,{status:'withdrawn',version:version+1,decidedAt:tx.stamp,reason:'Withdrawn by employee.'},sql`id=${id} AND employee_id=${employeeId} AND version=${version} AND status='pending'`);tx.insert(s.auditLog,{actorAccountId:ctx.account.id,employeeId,action:'schedule.open_shift_claim_withdrawn',entityType:'open-shift-claim',entityId:String(id),metadata:{},createdAt:tx.stamp});
 }
 if(!await tx.commit(revision,hash,['open-shift-claim']))throw new AuthError(409,'Your access or shared data changed. Reload open shifts.');return {saved:true,revision:revision+1};
}
