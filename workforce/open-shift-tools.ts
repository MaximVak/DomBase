import { and,eq,sql } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Context,Database } from './context';
import type { OpenShift,OpenSchedule } from '../app/open-shifts-model';
import { workingOpenShifts } from '../app/open-shifts-model';
import { weekFor,offsetScheduleDate,maxScheduleEntries } from '../app/schedule-tools-model';
import type { ScheduleSelection,ScheduleSource } from '../app/schedule-tools-model';
import { AuthError } from '../auth/http';
export const selectedOpenShift=(selection:ScheduleSelection)=>(row:OpenShift)=>selection.employeeIds===null&&(selection.departmentId===null||selection.departmentId===row.departmentId)&&(selection.roleId===null||selection.roleId===row.roleId);
export async function sourceOpenShifts(db:Database,ctx:Context,from:ScheduleSource,current:OpenSchedule,weekStart:number,notes:boolean){
 if(from.kind==='template'){
  const rows=await db.select({id:s.scheduleOpenTemplateEntries.id,roleId:s.scheduleOpenTemplateEntries.roleId,role:s.roles.name,departmentId:s.roles.departmentId,roleArchived:s.roles.archived,day:s.scheduleOpenTemplateEntries.dayOfWeek,start:s.scheduleOpenTemplateEntries.startTime,end:s.scheduleOpenTemplateEntries.endTime,station:s.scheduleOpenTemplateEntries.station,notes:notes?s.scheduleOpenTemplateEntries.notes:sql<string>`''`,color:s.scheduleOpenTemplateEntries.color}).from(s.scheduleOpenTemplateEntries).innerJoin(s.roles,eq(s.roles.id,s.scheduleOpenTemplateEntries.roleId)).where(and(eq(s.scheduleOpenTemplateEntries.templateId,from.id),ctx.activeActor())).limit(maxScheduleEntries+1);if(rows.length>maxScheduleEntries)throw new AuthError(400,'This open-shift template is too large.');return rows.map(row=>({...row,date:offsetScheduleDate('2026-11-08',row.day),version:0}));
 }
 const rows=await db.select({id:s.openShifts.id,roleId:s.openShifts.roleId,role:s.roles.name,departmentId:s.roles.departmentId,roleArchived:s.roles.archived,date:s.openShifts.date,start:s.openShifts.startTime,end:s.openShifts.endTime,station:s.openShifts.station,notes:notes?s.openShifts.notes:sql<string>`''`,color:s.openShifts.color,version:s.openShifts.version}).from(s.openShifts).innerJoin(s.roles,eq(s.roles.id,s.openShifts.roleId)).where(and(sql`${s.openShifts.archivedAt} IS NULL AND ${s.openShifts.filledShiftId} IS NULL AND ${s.openShifts.date} BETWEEN ${from.weekStart} AND ${offsetScheduleDate(from.weekStart,6)}`,ctx.roleFilter(s.roles.id),ctx.activeActor())).limit(2001);if(rows.length>2000)throw new AuthError(400,'Too many source open shifts.');return workingOpenShifts({...current,published:rows}).filter(row=>weekFor(row.date,weekStart)===from.weekStart);
}
export function clearOpenShifts(current:OpenSchedule,selected:(row:OpenShift)=>boolean){
 const removed=workingOpenShifts(current).filter(selected),ids=new Set(removed.map(row=>row.id)),publishedRemovals=current.published.filter(row=>ids.has(row.id)&&selected(row));return{removed,publishedRemovals,discarded:(current.draft?.upserted??[]).filter(row=>ids.has(row.id)).length,draft:{upserted:(current.draft?.upserted??[]).filter(row=>!ids.has(row.id)),deletedIds:[...new Set([...(current.draft?.deletedIds??[]),...publishedRemovals.map(row=>row.id)])]}};
}
export function copyOpenShifts(input:{current:OpenSchedule;source:OpenShift[];targets:string[];weekStart:number;selection:ScheduleSelection;mode:'add'|'replace';includeNotes:boolean;nextId:()=>number}){
 const matches=selectedOpenShift(input.selection),removed=input.mode==='replace'?clearOpenShifts(input.current,row=>input.targets.includes(weekFor(row.date,input.weekStart))&&matches(row)):{removed:[],draft:input.current.draft??{upserted:[],deletedIds:[]}};
 const copied=input.targets.flatMap(week=>input.source.filter(matches).map(row=>({id:input.nextId(),roleId:row.roleId,role:row.role,departmentId:row.departmentId,start:row.start,end:row.end,station:row.station,color:row.color,date:offsetScheduleDate(week,(new Date(`${row.date}T12:00:00Z`).getUTCDay()-input.weekStart+7)%7),notes:input.includeNotes?row.notes??'':'',version:0}))),draft={upserted:[...removed.draft.upserted,...copied],deletedIds:removed.draft.deletedIds};
 return{copied,removed:removed.removed,draft,plan:workingOpenShifts({...input.current,draft}),issues:draft.upserted.length>maxScheduleEntries||draft.deletedIds.length>maxScheduleEntries?['An open-shift draft supports500 additions/edits and500 removals. Reduce this selection first.']:[]};
}
