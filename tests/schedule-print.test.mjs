import assert from 'node:assert/strict';
import test from 'node:test';
import {loadServerModule} from '../scripts/server-runtime.mjs';
const {printPeriod,schedulePrintDocument}=await loadServerModule('app/schedule-print-model.ts');
const shift=(id,date='2026-11-12',extra={})=>({id,employeeId:1,date,start:'09:00',end:'17:00',role:'Sales',station:'Counter',notes:'PRIVATE SHIFT NOTE',...extra});
const base={location:'Fictional shop',timeZone:'America/Los_Angeles',start:'2026-11-09',end:'2026-11-15',weekStart:1,capturedAt:'2026-11-10T18:00:00Z',draft:false,canPrintDraft:true,scope:'Selected team members',employees:[{id:1,name:'Zoë <Admin>',email:'PRIVATE EMAIL',wage:'PRIVATE WAGE'}],shifts:[shift(1)]};
test('print periods preserve day, configured week, leap month and year boundaries',()=>{
 assert.deepEqual(printPeriod('2028-02-29','month',1),{start:'2028-02-01',end:'2028-02-29'});
 assert.deepEqual(printPeriod('2027-01-01','week',0),{start:'2026-12-27',end:'2027-01-02'});
 assert.deepEqual(printPeriod('2026-12-31','month',1),{start:'2026-12-01',end:'2026-12-31'});
 assert.deepEqual(printPeriod('2026-11-12','day',1),{start:'2026-11-12',end:'2026-11-12'});
});
test('published print ignores drafts, while explicit manager drafts apply additions, edits and removals without mutating the source',()=>{
 const input={...base,shifts:[shift(1),shift(2)],draftChanges:{upsertedShifts:[shift(1,undefined,{start:'10:00'}),shift(-3)],deletedShiftIds:[2],affectedEmployeeIds:[1]}};
 const before=structuredClone(input),published=schedulePrintDocument(input),draft=schedulePrintDocument({...input,draft:true});
 assert.equal(published.draft,false);assert.equal(published.sections[0].rows[0].cells[3].length,2);
 assert.equal(draft.draft,true);const cells=draft.sections[0].rows[0].cells[3];assert.equal(cells.length,2);assert.ok(cells.every(e=>e.draft));assert.ok(cells.some(e=>e.text.startsWith('10:00 AM')));
 assert.deepEqual(input,before);assert.equal(schedulePrintDocument({...input,draft:true,canPrintDraft:false}).draft,false);
});
test('print projection retains split/overnight/day off, open work and overlapping leave without private data or truncation',()=>{
 const data=schedulePrintDocument({...base,shifts:[...Array.from({length:9},(_,i)=>shift(i+1)),shift(10,undefined,{start:'22:00',end:'06:00'}),shift(11,undefined,{shiftType:'day_off'})],
  events:[{id:1,date:'2026-11-12',title:'Team event',notes:'PRIVATE EVENT NOTE'}],open:{published:[{...shift(22),roleId:1,version:1}],draft:null,roles:[]},
  leave:[{id:1,employeeId:1,startDate:'2026-11-12',endDate:'2026-11-12',status:'approved',explanation:'PRIVATE LEAVE REASON'}]});
 const rows=data.sections[0].rows.filter(row=>row.name==='Zoë <Admin>');assert.equal(rows.flatMap(row=>row.cells.flat()).length,12);assert.equal(rows.length,6);assert.ok(rows.slice(1).every(row=>row.continued));
 const text=JSON.stringify(data);assert.match(text,/ends next day/);assert.match(text,/Day off/);assert.match(text,/Approved time off/);assert.match(text,/Open shifts/);assert.doesNotMatch(text,/PRIVATE/);
});
test('month prints every selected calendar date once and keeps filtered-out employees and other-month work absent',()=>{
 const period=printPeriod('2026-11-15','month',1),data=schedulePrintDocument({...base,...period,shifts:[shift(1,'2026-11-01'),shift(2,'2026-11-30'),shift(3,'2026-12-01'),shift(4,undefined,{employeeId:2,role:'HIDDEN JOB'})]});
 const dates=data.sections.flatMap(s=>s.dates);assert.equal(dates.length,30);assert.equal(new Set(dates).size,30);assert.equal(dates[0],'2026-11-01');assert.equal(dates.at(-1),'2026-11-30');assert.doesNotMatch(JSON.stringify(data),/HIDDEN JOB|2026-12-01/);
 assert.equal(schedulePrintDocument({...base,employees:[],shifts:[]}).sections[0].rows[0].name,'No team members selected');
});
