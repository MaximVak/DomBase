import type { ShiftColor } from './shift-builder';
export type ExchangeKind = 'cover' | 'trade';
export type ExchangeStatus = 'pending' | 'accepted' | 'approved' | 'declined' | 'cancelled';
export type ExchangeShift = { id:number; employeeId:number; roleId:number; role:string; date:string; start:string; end:string; station:string; color:ShiftColor };
export type ExchangeRequest = {
  id:number; kind:ExchangeKind; status:ExchangeStatus; version:number;
  requesterId:number; requester:string; selectedEmployeeId:number|null; selectedEmployee:string|null;
  source:ExchangeShift; offered:ExchangeShift|null; requestedAt:string; acceptedAt:string|null; decidedAt:string|null; reason:string;
  invitation?:{id:number;status:'pending'|'accepted'|'declined'|'closed';version:number}; stale:boolean;
};
export type ExchangeFeed = {revision:number;contextToken:string;employeeId:number;requests:ExchangeRequest[];nextCursor:number|null};
export type ExchangeCandidates = {revision:number;contextToken:string;source:ExchangeShift;kind:ExchangeKind;people:{id:number;name:string}[]};
export type ExchangeOffers = {revision:number;contextToken:string;requestId:number;version:number;startDate:string;endDate:string;shifts:(ExchangeShift&{canOffer:boolean;unavailable:string})[]};
export const exchangeStamp = (value:string) => value.includes('T')?value:value.replace(' ','T')+'Z';
