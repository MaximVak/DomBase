import assert from 'node:assert/strict';
import test from 'node:test';
import {loadServerModule} from '../scripts/server-runtime.mjs';
const {occupiedScheduleIntervals,openShiftConflicts}=await loadServerModule('app/open-shifts-model.ts');
test('open-shift conflicts include overnight work and whole days off while allowing adjacent shifts',()=>{
 const rows=[{date:'2026-11-15',start:'22:00',end:'02:00'},{date:'2026-11-16',start:'09:00',end:'12:00'},{date:'2026-11-16',start:'11:00',end:'13:00'},{date:'2026-11-17',start:'09:00',end:'17:00',shiftType:'day_off'}];
 const occupied=occupiedScheduleIntervals(rows);
 const conflict=(date,start,end)=>openShiftConflicts({date,start,end},occupied);
 assert.equal(occupied.length,3);
 assert.equal(conflict('2026-11-16','01:30','03:00'),true);
 assert.equal(conflict('2026-11-16','02:00','09:00'),false);
 assert.equal(conflict('2026-11-16','12:30','14:00'),true);
 assert.equal(conflict('2026-11-16','13:00','14:00'),false);
 assert.equal(conflict('2026-11-17','00:00','00:30'),true);
 assert.equal(conflict('2026-11-17','23:00','23:59'),true);
 assert.equal(conflict('2026-11-18','00:00','01:00'),false);
 assert.equal(openShiftConflicts({date:'2026-11-16',start:'09:00',end:'10:00'},[]),false);
});
test('a proposed overnight interval includes next-day work and day off with exact adjacent boundaries',()=>{
 const night={date:'2026-11-16',start:'22:00',end:'06:00'};
 assert.equal(openShiftConflicts(night,occupiedScheduleIntervals([{date:'2026-11-17',start:'05:30',end:'08:00'}])),true);
 assert.equal(openShiftConflicts(night,occupiedScheduleIntervals([{date:'2026-11-17',start:'06:00',end:'08:00'}])),false);
 assert.equal(openShiftConflicts(night,occupiedScheduleIntervals([{date:'2026-11-17',start:'00:00',end:'00:00',shiftType:'day_off'}])),true);
});
