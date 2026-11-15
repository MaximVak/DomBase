import { and,desc,eq,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Context,Database } from './context';
import { AuthError } from '../auth/http';
import { rateKey,tokenIsValid } from '../auth/crypto';
import { canonical,newRecordId } from './contract';
import * as v from './validation';
import { WorkspaceTransaction } from './transaction';
import { readScheduleConflicts } from './conflicts';
import { eligibleForOpen,openShiftOverlap } from '../self/open-shifts';
import { openShiftIsFuture } from '../app/open-shifts-model';
import { selectNoticeRecipients,writePublicationNotices } from './publication-notices';
const columns={id:sql<number>`${s.openShiftClaims.id}`.as('claim_record_id'),openShiftId:s.openShiftClaims.openShiftId,employeeId:s.openShiftClaims.employeeId,employee:s.employees.name,status:s.openShiftClaims.status,version:s.openShiftClaims.version,openVersion:s.openShiftClaims.openVersion,requestedAt:s.openShiftClaims.requestedAt,decidedAt:s.openShiftClaims.decidedAt,reason:s.openShiftClaims.reason,shift:{id:sql<number>`${s.openShifts.id}`.as('shift_record_id'),role:s.roles.name,departmentId:s.roles.departmentId,date:s.openShifts.date,start:s.openShifts.startTime,end:s.openShifts.endTime,station:s.openShifts.station,color:s.openShifts.color}};
export async function readOpenClaimRequests(db:Database,ctx:Context,url:URL){
 ctx.requirePermission('schedule.read');ctx.requirePermission('schedule.manage');if([...url.searchParams.keys()].some(key=>!['openShiftId','cursor','history'].includes(key))||['openShiftId','cursor','history'].some(key=>url.searchParams.getAll(key).length>1))throw new AuthError(400,'Invalid request filters.');
 const openShiftId=url.searchParams.has('openShiftId')?v.integer(Number(url.searchParams.get('openShiftId'))):null,history=url.searchParams.get('history')==='true';if(url.searchParams.has('history')&&!['true','false'].includes(url.searchParams.get('history')!))throw new AuthError(400,'Invalid history filter.');
 const [meta]=await db.select().from(s.workforceState).where(and(eq(s.workforceState.id,1),ctx.activeActor())).limit(1);if(!meta)throw new AuthError(401,'Sign in to continue.');
 let cursor=sql`1=1`;if(url.searchParams.has('cursor')){const id=v.integer(Number(url.searchParams.get('cursor')));const[prior]=await db.select({at:s.openShiftClaims.requestedAt}).from(s.openShiftClaims).innerJoin(s.openShifts,eq(s.openShifts.id,s.openShiftClaims.openShiftId)).where(and(eq(s.openShiftClaims.id,id),ctx.roleFilter(s.openShifts.roleId),ctx.employeeFilter(s.openShiftClaims.employeeId),ctx.activeActor())).limit(1);if(!prior)throw new AuthError(404,'Request history page is unavailable.');cursor=sql`(julianday(${s.openShiftClaims.requestedAt})<julianday(${prior.at}) OR (julianday(${s.openShiftClaims.requestedAt})=julianday(${prior.at}) AND ${s.openShiftClaims.id}<${id}))`;}
 const rows=await db.select(columns).from(s.openShiftClaims).innerJoin(s.openShifts,eq(s.openShifts.id,s.openShiftClaims.openShiftId)).innerJoin(s.roles,eq(s.roles.id,s.openShifts.roleId)).innerJoin(s.employees,eq(s.employees.id,s.openShiftClaims.employeeId)).where(and(ctx.roleFilter(s.openShifts.roleId),ctx.employeeFilter(s.employees.id),ctx.activeActor(),history?sql`1=1`:eq(s.openShiftClaims.status,'pending'),openShiftId?eq(s.openShiftClaims.openShiftId,openShiftId):sql`1=1`,cursor)).orderBy(desc(sql`julianday(${s.openShiftClaims.requestedAt})`),desc(s.openShiftClaims.id)).limit(51);
 const [current]=await db.select().from(s.workforceState).where(and(eq(s.workforceState.id,1),ctx.activeActor())).limit(1);if(!current)throw new AuthError(401,'Sign in to continue.');if(current.revision!==meta.revision)throw new AuthError(409,'Shared data changed. Reload requests.');
 return {revision:meta.revision,claims:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
}
export async function decideOpenClaim(db:Database,ctx:Context,body:Record<string,unknown>,options:{secret:string;emailEnabled?:boolean;now?:()=>number}){
 ctx.requirePermission('schedule.read');ctx.requirePermission('schedule.manage');const action=v.oneOf(body.action,['decision-preview','decide']);v.keys(body,['action','revision','claimId','decision','reason',...(action==='decide'?['id','reviewToken']:[])]);
 const now=(options.now??Date.now)(),revision=v.integer(body.revision,0),claimId=v.integer(body.claimId),decision=v.oneOf(body.decision,['approve','decline']),reason=v.text(body.reason??'',300),hash=`open-decision:${rateKey(options.secret,canonical(body))}`;
 if(action==='decide'){if(!tokenIsValid(body.id))throw new AuthError(400,'Invalid save identifier.');const[prior]=await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id,body.id),ctx.activeActor())).limit(1);if(prior){if(prior.accountId!==ctx.account.id||prior.bodyHash!==hash)throw new AuthError(409,'Save identifier already in use.');return {saved:true,revision:prior.revision};}}
 const[meta]=await db.select({revision:s.workforceState.revision,master:s.locationSettings.notifyScheduleChanges}).from(s.workforceState).innerJoin(s.locationSettings,eq(s.locationSettings.businessId,1)).where(and(eq(s.workforceState.id,1),ctx.activeActor())).limit(1);if(!meta)throw new AuthError(401,'Sign in to continue.');if(meta.revision!==revision)throw new AuthError(409,'Shared data changed. Reload before reviewing.');
 const[claim]=await db.select().from(s.openShiftClaims).where(and(eq(s.openShiftClaims.id,claimId),ctx.employeeFilter(s.openShiftClaims.employeeId),ctx.activeActor())).limit(1);if(!claim)throw new AuthError(404,'Request is unavailable.');
 const[open]=await db.select().from(s.openShifts).where(and(eq(s.openShifts.id,claim.openShiftId),ctx.roleFilter(s.openShifts.roleId),ctx.activeActor())).limit(1);if(!open)throw new AuthError(404,'Open shift is unavailable.');if(claim.status!=='pending')throw new AuthError(409,'This request was already decided or withdrawn. Reload requests.');
 const[role]=await db.select().from(s.roles).where(and(eq(s.roles.id,open.roleId),ctx.activeActor())).limit(1);if(!role)throw new AuthError(404,'Job is unavailable.');
 let warnings=null;if(decision==='approve'){
  if(open.archivedAt||open.filledShiftId)throw new AuthError(409,'This open shift was filled or cancelled.');if(open.version!==claim.openVersion)throw new AuthError(409,'The open shift changed. Ask the employee to request its current version.');if(!openShiftIsFuture(open.date,open.startTime,now))throw new AuthError(400,'This open shift has already started.');
  if(!await db.get(sql`SELECT 1 WHERE ${eligibleForOpen(claim.employeeId,open.roleId)} AND ${ctx.activeActor()}`))throw new AuthError(409,'The employee is no longer eligible or assigned to this job.');
  if(await openShiftOverlap(db,claim.employeeId,{id:-1,date:open.date,start:open.startTime,end:open.endTime}))throw new AuthError(409,'This employee has a conflicting published shift or day off.');
  warnings=await readScheduleConflicts(db,ctx,{revision,period:{start:open.date,end:open.date},upserts:[{id:-1,employeeId:claim.employeeId,date:open.date,start:open.startTime,end:open.endTime,role:role.name,shiftType:'work'}],deletedShiftIds:[]});
 }
 const[last]=await db.select({version:s.schedulePublications.version}).from(s.schedulePublications).orderBy(desc(s.schedulePublications.version)).limit(1);
 const token=rateKey(options.secret,canonical({actor:ctx.account.id,revision,claimId,claimVersion:claim.version,openVersion:open.version,decision,reason,last:last?.version??0}));
 if(action==='decision-preview'){
  const[current]=await db.select().from(s.workforceState).where(and(eq(s.workforceState.id,1),ctx.activeActor())).limit(1);if(!current)throw new AuthError(401,'Sign in to continue.');if(current.revision!==revision)throw new AuthError(409,'Shared data changed. Reload requests.');return {revision,reviewToken:token,warnings,shift:{id:-1,employeeId:claim.employeeId,date:open.date,start:open.startTime,end:open.endTime,role:role.name},decision};
 }
 if(body.reviewToken!==token)throw new AuthError(409,'Review this exact request and decision before saving.');
 const tx=new WorkspaceTransaction(db,ctx,body.id as string,new Date(now).toISOString()),publicationId=newRecordId();
 const others=decision==='approve'?await db.select().from(s.openShiftClaims).where(and(eq(s.openShiftClaims.openShiftId,open.id),eq(s.openShiftClaims.status,'pending'),ctx.activeActor())).limit(2001):[claim];if(others.length>2000)throw new AuthError(503,'Too many requests to decide safely.');
 const recipients=await selectNoticeRecipients(db,ctx,meta.master,{inApp:true,email:!!options.emailEnabled},[...new Set(others.map(row=>row.employeeId))]);
 tx.insert(s.schedulePublications,{id:publicationId,version:(last?.version??0)+1,publishedByAccountId:ctx.account.id,publishedAt:tx.stamp,noticeType:'open_shift_request',departmentId:role.departmentId,periodStart:open.date,periodEnd:open.date,notifyMode:'changed',notifyInApp:true,notifyEmail:!!options.emailEnabled,scopeDepartments:role.departmentId===null?[]:[role.departmentId]});
 if(decision==='approve'){
  const shiftId=newRecordId();tx.insert(s.shifts,{id:shiftId,employeeId:claim.employeeId,roleId:open.roleId,roleName:role.name,date:open.date,startTime:open.startTime,endTime:open.endTime,station:open.station,notes:open.notes,shiftType:'work',color:open.color,publicationId},eligibleForOpen(claim.employeeId,open.roleId));
  tx.update(s.openShifts,{filledShiftId:shiftId,version:open.version+1,publicationId,updatedAt:tx.stamp},sql`id=${open.id} AND version=${open.version} AND filled_shift_id IS NULL AND archived_at IS NULL`);
 }
 tx.updateRows(s.openShiftClaims,others.map(row=>({id:row.id,status:row.id===claim.id&&decision==='approve'?'approved':'declined',version:row.version+1,decidedAt:tx.stamp,decidedByAccountId:ctx.account.id,reason:row.id===claim.id?(reason||(decision==='approve'?'Approved by manager.':'Not approved by manager.')):'Another request was approved for this open shift.'})),'id',sql`status='pending' AND version=json_extract(entry.value,'$.version')-1`);
 tx.insertRows(s.auditLog,others.map(row=>({actorAccountId:ctx.account.id,employeeId:row.employeeId,action:row.id===claim.id&&decision==='approve'?'schedule.open_shift_claim_approved':'schedule.open_shift_claim_declined',entityType:'open-shift-claim',entityId:String(row.id),metadata:{openShiftId:open.id,publicationId},createdAt:tx.stamp})));
 writePublicationNotices(tx,publicationId,recipients,{title:'Open shift request updated',detail:'A manager updated your open shift request. Open My schedule to review the result.'});
 if(!await tx.commit(revision,hash,['open-shift-claim','schedule-publish']))throw new AuthError(409,'Your access or shared data changed. Reload requests.');return {saved:true,revision:revision+1};
}
