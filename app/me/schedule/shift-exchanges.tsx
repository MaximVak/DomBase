"use client";
import {useState} from 'react';
import type {ExchangeFeed,ExchangeKind,ExchangeRequest} from '../../shift-exchanges-model';
import {useExchangeRequests} from '../../use-shift-exchanges';
import {ExchangeSummary} from '../../shift-exchange-summary';
import {ComposeExchange,OfferExchange} from './exchange-compose';
export type ExchangeEditor={sourceShiftId:number;kind:ExchangeKind};
export function EmployeeShiftExchanges({editor,onClose,onScheduleChange}:{editor:ExchangeEditor|null;onClose:()=>void;onScheduleChange:()=>void}){
 const[offer,setOffer]=useState<ExchangeRequest|null>(null),[localNotice,setLocalNotice]=useState('');
 const feed=useExchangeRequests<ExchangeFeed>('/api/self/shift-exchanges','',!!editor||!!offer),data=feed.data;
 async function respond(row:ExchangeRequest,action:'accept'|'decline'|'cancel'){
  if(!data)return;setLocalNotice('');const saved=await feed.save({contextToken:data.contextToken,revision:data.revision,action,requestId:row.id,version:row.version},action==='accept'?'Accepted. A manager must approve before your schedule changes.':action==='decline'?'Invitation declined.':'Request cancelled.');if(saved)onScheduleChange();
 }
 const refreshed=(message:string)=>{setLocalNotice(message);onClose();setOffer(null);void feed.load();onScheduleChange();};
 return <section className="employee-open-shifts" aria-label="My shift trades and cover requests" aria-busy={feed.pending}>
  <div className="schedule-alert-heading"><h2>Trades & cover requests</h2><button type="button" data-exchange-focus aria-label="Reload shift requests" disabled={feed.pending||!!editor||!!offer} onClick={()=>{void feed.load();onScheduleChange();}}>Reload requests</button></div>
  <p>Use Request cover or Request trade on one of your future shifts below. A teammate accepts first; a manager makes the final decision.</p>{localNotice||feed.notice?<p role="status">{localNotice||feed.notice}</p>:null}{feed.error?<p role="alert">{feed.error}</p>:null}{feed.pending?<p role="status">Loading or saving shift requests…</p>:null}
  {data?<>{!data.requests.length?<p>No trade or cover requests yet.</p>:<ul className="open-shift-request-list">{data.requests.map(row=><li key={row.id}><ExchangeSummary request={row} employeeId={data.employeeId}/><div className="open-shift-actions">
   {row.requesterId===data.employeeId&&row.status==='pending'?<button type="button" disabled={feed.pending||feed.needsReload} onClick={()=>void respond(row,'cancel')}>Cancel request</button>:null}
   {row.invitation?.status==='pending'&&row.status==='pending'?<><button type="button" disabled={feed.pending||feed.needsReload||row.stale} onClick={()=>row.kind==='trade'?setOffer(row):void respond(row,'accept')}>{row.kind==='trade'?'Review and offer a return shift':'Accept cover request'}</button><button type="button" disabled={feed.pending||feed.needsReload} onClick={()=>void respond(row,'decline')}>Decline invitation</button></>:null}
  </div></li>)}</ul>}{data.nextCursor?<button type="button" disabled={feed.pending} onClick={()=>void feed.load(data.nextCursor!)}>Older trade & cover requests</button>:null}</>:null}
  {editor?<ComposeExchange {...editor} onClose={onClose} onSaved={()=>refreshed('Request sent. Your schedule stays unchanged until a teammate accepts and a manager approves.')}/>:null}
  {offer?<OfferExchange request={offer} onClose={()=>setOffer(null)} onAccepted={()=>refreshed('Trade accepted. Both assignments stay unchanged until manager approval.')}/>:null}
 </section>;
}
