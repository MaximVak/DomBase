import { and,eq,sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as s from '../db/schema';
import type { Context,Database } from './context';
import type { WorkspaceTransaction } from './transaction';
import { AuthError } from '../auth/http';
import { validEmail } from '../backup/email-config.mjs';
export type NoticeRecipient={employeeId:number;name:string;inApp:boolean;emailRequested:boolean;address:string};
export async function selectNoticeRecipients(db:Database,ctx:Context,master:boolean,options:{inApp:boolean;email:boolean},ids:number[]):Promise<NoticeRecipient[]>{
 const people=await db.select({id:s.employees.id,name:s.employees.name,email:s.employees.email,alerts:s.employeeSettings.sendLocationAlerts,inApp:s.scheduleNotificationPreferences.inApp,emailPreference:s.scheduleNotificationPreferences.email}).from(s.employees).leftJoin(s.employeeSettings,eq(s.employeeSettings.employeeId,s.employees.id)).leftJoin(s.scheduleNotificationPreferences,eq(s.scheduleNotificationPreferences.employeeId,s.employees.id)).where(and(eq(s.employees.active,true),eq(s.employees.terminated,false),ctx.employeeFilter(s.employees.id),ctx.activeActor(),sql`${s.employees.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`)).limit(2001);
 if(people.length>2000)throw new AuthError(503,'Too many recipients to notify safely.');
 return people.map(person=>({employeeId:person.id,name:person.name,inApp:master&&person.alerts!==false&&options.inApp&&person.inApp!==false,emailRequested:master&&person.alerts!==false&&options.email&&person.emailPreference!==false,address:validEmail(person.email.trim())?person.email.trim().toLowerCase():''})).filter(person=>person.inApp||person.emailRequested);
}
export function writePublicationNotices(tx:WorkspaceTransaction,publicationId:number,recipients:NoticeRecipient[],text?:{title:string;detail:string}){
 const emails=new Map<string,string>();for(const person of recipients)if(person.emailRequested&&person.address)emails.set(person.address,`schedule-email-${publicationId}-${createHash('sha256').update(person.address).digest('hex')}`);
 tx.insertRows(s.scheduleEmails,[...emails].map(([recipient,id])=>({id,publicationId,recipient,state:'pending',createdAt:tx.stamp,updatedAt:tx.stamp})));
 tx.insertRows(s.schedulePublicationRecipients,recipients.map(person=>({publicationId,employeeId:person.employeeId,inApp:person.inApp,emailRequested:person.emailRequested,emailId:person.emailRequested&&person.address?emails.get(person.address):null})));
 tx.insertRows(s.notifications,recipients.filter(person=>person.inApp).map(person=>({id:`schedule-${publicationId}-${person.employeeId}`,employeeId:person.employeeId,sourceKey:`publication:${publicationId}`,kind:'schedule',title:text?.title??'Schedule published',detail:text?.detail??'Your published schedule was updated. Open My schedule to review it.',occurredAt:tx.stamp,publicationId})));
}
