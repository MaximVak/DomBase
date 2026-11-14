import assert from 'node:assert/strict';
import test from 'node:test';
import {loadServerModule} from '../scripts/server-runtime.mjs';
const {scheduleConflicts}=await loadServerModule('app/schedule-conflicts.ts');
const {defaultScheduleEnforcement:settings,normalizeScheduleEnforcement}=await loadServerModule('app/schedule-enforcement.ts');
const {plusDays}=await loadServerModule('team/rules.ts');
const shift=(patch={})=>({id:1,employeeId:1,date:'2026-11-13',start:'09:00',end:'17:00',role:'Sales',...patch});
const availability=(patch={})=>({id:1,employeeId:1,effectiveDate:'2026-01-01',status:'approved',submittedAt:'2026-11-01T20:00:00Z',slots:[],...patch});
const run=(shifts,patch={})=>scheduleConflicts({shifts,availability:[availability()],leave:[],settings,employees:[],availabilityAllowed:true,leaveAllowed:true,...patch});
const codes=(rows,id=1)=>rows.find(row=>row.shiftId===id)?.codes??[];

test('approved unavailability uses exact overlap, all daily periods, and effective versions without restricting preferred hours',()=>{
 const request=availability({slots:[{day:'Friday',preference:'unavailable',startHour:10.25,endHour:11.5},{day:'Friday',preference:'preferred',startHour:12,endHour:13}]});
 assert.ok(codes(run([shift()],{availability:[request]})).includes('unavailable'));
 assert.ok(!codes(run([shift({start:'11:30'})],{availability:[request]})).includes('unavailable'));
 for(const status of ['pending','rejected']) assert.deepEqual(codes(run([shift()],{availability:[{...request,status}]})),['availability_missing']);
 assert.deepEqual(codes(run([shift()],{availability:[{...request,effectiveDate:'2026-11-16'}]})),['availability_missing']);
 assert.ok(!codes(run([shift()],{availability:[{...request,slots:[{...request.slots[0],preference:'preferred'}]}]})).includes('unavailable'));
});
test('availability reminders follow shift date and the editable 90-day interval, with Pacific dates and an off setting',()=>{
 const old=availability({submittedAt:plusDays('2026-11-13',-90)+'T20:00:00Z'});
 assert.ok(!codes(run([shift()],{availability:[old]})).includes('availability_outdated'));
 old.submittedAt=plusDays('2026-11-13',-91)+'T20:00:00Z';assert.ok(codes(run([shift()],{availability:[old]})).includes('availability_outdated'));
 assert.ok(!codes(run([shift()],{availability:[old],settings:{...settings,availabilityReviewDays:0}})).includes('availability_outdated'));
 assert.ok(codes(run([shift()],{availability:[],settings:{...settings,availabilityReviewDays:0}})).includes('availability_missing'));
 assert.deepEqual(run([shift()],{availability:[],availabilityAllowed:false}),[]);
 const pacific=availability({submittedAt:plusDays('2026-11-13',-90)+'T01:00:00Z'});assert.ok(codes(run([shift()],{availability:[pacific]})).includes('availability_outdated'));
});
test('short rest compares the last and first shifts of different workdays and honors exact boundaries, employees and split shifts',()=>{
 const rows=[shift({date:'2026-11-12',start:'18:00',end:'22:00'}),shift({id:2,start:'08:00',end:'12:00'})];
 assert.ok(!run(rows).some(row=>row.codes.includes('short_rest')));
 rows[1].start='07:59';assert.ok(codes(run(rows)).includes('short_rest'));assert.ok(codes(run(rows),2).includes('short_rest'));
 assert.ok(!run(rows,{settings:{...settings,minRestHours:0}}).some(row=>row.codes.includes('short_rest')));
 rows[1].employeeId=2;assert.ok(!run(rows).some(row=>row.codes.includes('short_rest')));
 const splits=[shift({start:'09:00',end:'12:00'}),shift({id:2,start:'13:00',end:'17:00'})];assert.ok(!run(splits).some(row=>row.codes.includes('short_rest')));
});
test('rest uses real Pacific elapsed time through spring/fall changes and flags ambiguous or nonexistent wall clocks',()=>{
 const spring=[shift({date:'2026-03-07',start:'20:00',end:'22:00'}),shift({id:2,date:'2026-03-08',start:'08:00',end:'12:00'})];
 assert.ok(codes(run(spring)).includes('short_rest'));
 const fall=[shift({date:'2026-10-31',start:'20:00',end:'22:00'}),shift({id:2,date:'2026-11-01',start:'07:00',end:'12:00'})];
 assert.ok(!run(fall).some(row=>row.codes.includes('short_rest')));
 for(const value of [shift({date:'2026-03-08',start:'02:30',end:'08:00'}),shift({date:'2026-11-01',start:'01:30',end:'08:00'}),shift({date:'2026-11-01',start:'00:00',end:'04:00'})]) assert.ok(codes(run([value])).includes('time_review'));
});
test('approved leave conflicts use dates and partial-day boundaries, with day off and unreadable leave excluded',()=>{
 const leave=[{employeeId:1,startDate:'2026-11-12',endDate:'2026-11-14',startTime:'10:00',endTime:'12:00'}];
 assert.ok(codes(run([shift()],{leave})).includes('time_off'));
 assert.ok(!codes(run([shift({start:'12:00'})],{leave})).includes('time_off'));
 assert.ok(!codes(run([shift({date:'2026-11-15'})],{leave})).includes('time_off'));
 assert.ok(!codes(run([shift()],{leave,leaveAllowed:false})).includes('time_off'));
 assert.deepEqual(run([shift({shiftType:'day_off',start:'00:00',end:'00:00'})],{leave}),[]);
 assert.ok(codes(run([shift()],{leave:[{...leave[0],startTime:null,endTime:null}]})).includes('time_off'));
});
test('scheduled overtime uses paid split/weekly hours, does not double count premiums and respects recorded exemption',()=>{
 const days=Array.from({length:5},(_,i)=>shift({id:i+1,date:plusDays('2026-11-09',i)}));
 assert.ok(!run(days).some(row=>row.codes.includes('overtime')));
 assert.ok(!run(days,{settings:{...settings,mandatoryMealBreak:false}}).some(row=>row.codes.includes('overtime')));
 days.push(shift({id:6,date:'2026-11-14',start:'09:00',end:'13:00'}));assert.ok(run(days).every(row=>row.codes.includes('overtime')));
 const long=shift({start:'08:00'});assert.ok(codes(run([long])).includes('overtime'));
 const employees=[{id:1,wageRates:[{id:1,roleId:1,role:'Sales',amountCents:0,basis:'annual_salary',overtimeExempt:true,effectiveDate:'2026-01-01'}]}];
 assert.ok(!codes(run([long],{employees})).includes('overtime'));
 const split=[shift({end:'13:00'}),shift({id:2,start:'14:00',end:'18:00'})];assert.ok(!run(split).some(row=>row.codes.includes('overtime')));
});
test('warning review and setting changes do not mutate stored plans, preferences or leave',()=>{
 const shifts=[shift()],input={availability:[availability({submittedAt:'2025-01-01T20:00:00Z'})],leave:[{employeeId:1,startDate:'2026-11-13',endDate:'2026-11-13',startTime:null,endTime:null}]};
 const before=structuredClone({shifts,...input});run(shifts,input);run(shifts,{...input,settings:{...settings,availabilityReviewDays:0,minRestHours:0}});assert.deepEqual({shifts,...input},before);
 assert.equal(normalizeScheduleEnforcement({minRestHours:25}).minRestHours,10);assert.equal(normalizeScheduleEnforcement({availabilityReviewDays:366}).availabilityReviewDays,90);assert.equal(normalizeScheduleEnforcement({minRestHours:0,availabilityReviewDays:0}).minRestHours,0);
});
