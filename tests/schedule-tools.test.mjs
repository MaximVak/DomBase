import assert from 'node:assert/strict';import test from 'node:test';import{loadServerModule}from'../scripts/server-runtime.mjs';
const {buildScheduleToolPlan,repeatScheduleWeeks,weekFor}=await loadServerModule('app/schedule-tools-model.ts');
const shift=(id,date='2026-11-09',patch={})=>({id,employeeId:1,date,start:'09:15',end:'12:30',role:'Fictional role',station:'Counter',notes:'Fictional note',color:'amber',shiftType:'work',...patch});
function plan(input){let next=0;return buildScheduleToolPlan({source:[shift(1)],targets:['2026-11-16'],weekStart:1,published:[],mode:'add',selected:()=>true,nextId:()=>--next,includeNotes:false,...input});}
test('copy maps weekdays through month/year/DST boundaries and each configured workweek start',()=>{
 for(const start of [0,1,2,3,4,5,6]){const date=weekFor('2026-12-31',start),target=repeatScheduleWeeks(date,1)[0];const r=plan({weekStart:start,source:[shift(1,'2026-12-31')],targets:[target]});assert.equal(r.copied[0].date,'2027-01-07');assert.equal(r.copied[0].start,'09:15');assert.equal(r.copied[0].color,'amber');assert.equal(r.copied[0].station,'Counter');assert.equal(r.copied[0].notes,'');}
 assert.deepEqual(repeatScheduleWeeks('2026-03-02',4),['2026-03-09','2026-03-16','2026-03-23','2026-03-30']);assert.deepEqual(repeatScheduleWeeks('2026-10-26',2),['2026-11-02','2026-11-09']);
});
test('selected replacement preserves other employees, dates, published rows and unrelated drafts',()=>{
 const published=[shift(10,'2026-11-16'),shift(11,'2026-11-16',{employeeId:2}),shift(12,'2026-11-23')];const draft={upsertedShifts:[shift(20,'2026-11-16'),shift(21,'2026-12-01')],deletedShiftIds:[12],affectedEmployeeIds:[1]};const before=structuredClone({published,draft});
 const r=plan({published,draft,mode:'replace',selected:s=>s.employeeId===1,includeNotes:true});assert.deepEqual(r.draft.deletedShiftIds,[12,10]);assert.deepEqual(r.draft.upsertedShifts.map(s=>s.id),[21,-1]);assert.deepEqual(r.plan.map(s=>s.id),[11,21,-1]);assert.equal(r.copied[0].notes,'Fictional note');assert.deepEqual({published,draft},before);
});
test('default add preserves existing entries and blocks overlap; split shifts, day off and bounded drafts remain explicit',()=>{
 assert.match(plan({published:[shift(2,'2026-11-16')]}).issues.join(),/overlapping/);
 const split=plan({source:[shift(1),shift(2,'2026-11-09',{start:'13:00',end:'17:00'}),shift(3,'2026-11-10',{start:'00:00',end:'00:00',shiftType:'day_off'})]});assert.equal(split.issues.length,0);assert.equal(split.copied.length,3);assert.equal(split.copied[2].shiftType,'day_off');
 assert.match(plan({source:[shift(1,'2026-11-09',{shiftType:'day_off',start:'00:00',end:'00:00'}),shift(2)]}).issues.join(),/day off/);
 assert.match(plan({source:[]}).issues.join(),/No shifts/);assert.match(plan({source:Array.from({length:501},(_,i)=>shift(i,'2026-11-09',{employeeId:i+1}))}).issues.join(),/500/);
});
