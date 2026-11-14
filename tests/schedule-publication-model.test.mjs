import assert from 'node:assert/strict';import test from 'node:test';import{loadServerModule}from'../scripts/server-runtime.mjs';
const{changedSchedulePeople}=await loadServerModule('app/schedule-publish-model.ts'),{buildClearedSchedule,workingPlan}=await loadServerModule('app/schedule-tools-model.ts');
const shift=(id,date='2026-11-09',patch={})=>({id,date,employeeId:1,start:'09:00',end:'12:00',role:'Job A',station:'Floor',...patch});
test('changed people includes former assignees, removals and meaningful changes while normalizing defaults',()=>{
 const original=[shift(1),shift(2),shift(3)];assert.deepEqual([...changedSchedulePeople(original,[shift(1,'2026-11-10')],[])],[1]);
 assert.equal(changedSchedulePeople(original,[shift(1,'2026-11-09',{notes:'',color:'blue',shiftType:'work'})],[]).size,0);
 assert.deepEqual([...changedSchedulePeople(original,[shift(1,'2026-11-09',{employeeId:2})],[3])].sort(),[1,2]);
 assert.equal(changedSchedulePeople(original,[shift(1,'2026-11-09',{notes:'Changed'})],[]).has(1),true);
});
test('clearing draft moves into a selected week restores outside originals and preserves moves out',()=>{
 const published=[shift(1,'2026-11-02'),shift(2),shift(3),shift(4,'2026-11-09',{role:'Job B'})];
 const draft={upsertedShifts:[shift(1),shift(2,'2026-11-16'),shift(5),shift(4)],deletedShiftIds:[99],affectedEmployeeIds:[1]};const before=structuredClone({published,draft});
 const result=buildClearedSchedule(published,draft,row=>row.date==='2026-11-09'&&row.role==='Job A');
 assert.deepEqual(result.removed.map(row=>row.id).sort(),[1,3,4,5]);assert.deepEqual(result.draft.deletedShiftIds,[99,3]);assert.deepEqual(result.draft.upsertedShifts.map(row=>row.id),[2]);
 const final=workingPlan(published,result.draft);assert.ok(final.some(row=>row.id===1&&row.date==='2026-11-02'));assert.ok(final.some(row=>row.id===4&&row.role==='Job B'));assert.ok(final.some(row=>row.id===2&&row.date==='2026-11-16'));assert.deepEqual({published,draft},before);
});
