import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {backupEmailConfigBlock} from '../backup/email-config.mjs';
import {nextBackupAlerts, expectedBackupDay} from '../backup/alerts.mjs';
import {loadServerModule} from '../scripts/server-runtime.mjs';
const {backupNotice}=await loadServerModule('backup/notice.ts');
const {BackupMonitorView}=await loadServerModule('app/backup-monitor.tsx');
const at=s=>Date.parse(s);
const base={lastSuccess:{localDay:'2026-11-11',createdAt:'2026-11-11T10:05:00Z'},lastAttempt:{state:'succeeded',localDay:'2026-11-11',at:'2026-11-11T10:05:00Z'}};

test('missing daily backups allow the 2AM job time, then alert at exactly 4AM Pacific',()=>{
 assert.equal(nextBackupAlerts(base,at('2026-11-12T11:59:59Z')).active,null);
 const a=nextBackupAlerts(base,at('2026-11-12T12:00:00Z')).active;
 assert.equal(a.kind,'stale');assert.equal(a.expectedDay,'2026-11-12');
 assert.equal(nextBackupAlerts({...base,lastSuccess:{...base.lastSuccess,localDay:'2026-11-10'}},at('2026-11-12T10:01:00Z')).active.kind,'stale','already overdue yesterday has no new grace window');
 assert.equal(nextBackupAlerts({},at('2026-11-12T11:00:00Z')).active,null);
 assert.equal(nextBackupAlerts({},at('2026-11-12T12:00:00Z')).active.kind,'stale');
});
test('Pacific previous-day logic handles the repeated fall hour and skipped spring hour',()=>{
 for(const stamp of ['2026-11-01T08:30:00Z','2026-11-01T09:30:00Z'])assert.equal(expectedBackupDay(at(stamp)),'2026-10-31');
 assert.equal(expectedBackupDay(at('2026-03-08T09:59:00Z')),'2026-03-07');
 assert.equal(expectedBackupDay(at('2026-03-08T10:00:00Z')),'2026-03-08');
 const s={lastSuccess:{localDay:'2026-03-07',createdAt:'2026-03-07T10:00:00Z'}};
 assert.equal(nextBackupAlerts(s,at('2026-03-08T10:59:59Z')).active,null);
 assert.equal(nextBackupAlerts(s,at('2026-03-08T11:00:00Z')).active.kind,'stale');
});
test('failure alerts are immediate, survive retries and keep one identity until real success',()=>{
 const failed={...base,lastAttempt:{state:'failed',localDay:'2026-11-12',at:'2026-11-12T10:01:00Z'}};
 const alerts=nextBackupAlerts(failed,at('2026-11-12T10:01:01Z'));assert.equal(alerts.active.kind,'failed');
 const running={...failed,alerts,lastAttempt:{...failed.lastAttempt,state:'running',at:'2026-11-12T10:16:00Z'}};
 assert.deepEqual(nextBackupAlerts(running,at('2026-11-12T10:16:00Z')),alerts);
 assert.deepEqual(nextBackupAlerts({...failed,alerts,lastAttempt:{...failed.lastAttempt,at:'2026-11-12T10:17:00Z'}},at('2026-11-12T10:17:00Z')),alerts);
 const good={...running,lastSuccess:{localDay:'2026-11-12',createdAt:'2026-11-12T10:16:00Z'},lastAttempt:{...running.lastAttempt,state:'succeeded'}};
 const recovered=nextBackupAlerts(good,at('2026-11-12T10:18:00Z'));assert.equal(recovered.active,null);assert.equal(recovered.lastRecovery.incidentId,alerts.active.id);
 assert.deepEqual(nextBackupAlerts({...good,alerts:recovered},at('2026-11-12T10:19:00Z')),recovered,'no duplicate recovery on later checks');
});
test('day rollover, running retries and older completions cannot dismiss an unresolved warning',()=>{
 const alerts=nextBackupAlerts(base,at('2026-11-12T12:00:00Z'));
 assert.deepEqual(nextBackupAlerts({...base,alerts},at('2026-11-13T10:01:00Z')),alerts);
 const failed={...base,lastAttempt:{state:'failed',at:'2026-11-12T10:01:00Z'}};
 const a=nextBackupAlerts(failed,at('2026-11-12T10:02:00Z'));
 assert.deepEqual(nextBackupAlerts({...failed,alerts:a,lastSuccess:{localDay:'2026-11-12',createdAt:'2026-11-12T10:00:00Z'},lastAttempt:{state:'succeeded',at:'2026-11-12T10:00:00Z'}},at('2026-11-12T10:05:00Z')),a);
});
test('Owner notices distinguish healthy, overdue, unavailable, pending and recovery states',()=>{
 const healthy={configured:true,stale:false,checkedAt:'2026-11-12T13:00:00Z',alerts:{active:null,lastRecovery:null}};
 assert.equal(backupNotice(healthy,false),null);
 assert.match(backupNotice(healthy,true).title,/unavailable/);
 assert.match(backupNotice({...healthy,alerts:nextBackupAlerts(base,at('2026-11-12T12:00:00Z'))},false).title,/overdue/);
 assert.match(backupNotice({...healthy,stale:true},false,true).title,/pending/);
 const r={...healthy,alerts:{active:null,lastRecovery:{incidentId:'backup-stale-2026-11-12',kind:'stale',detectedAt:'2026-11-12T12:00:00Z',recoveredAt:'2026-11-12T12:30:00Z'}}};
 assert.match(backupNotice(r,false).title,/restored/);
 assert.equal(backupNotice({...r,checkedAt:'2026-11-14T12:30:00Z'},false),null);
 assert.match(backupNotice({...r,checkedAt:'2026-11-14T12:30:00Z'},false,true).title,/restored/);
 const html=renderToStaticMarkup(React.createElement(BackupMonitorView,{status:healthy,unavailable:true}));assert.match(html,/role="alert"/);assert.match(html,/href="\/backups"/);
 assert.equal(renderToStaticMarkup(React.createElement(BackupMonitorView,{status:healthy,unavailable:false})), '');
});


test('a fresh validation of the completed daily archive clears a temporary confirmation failure',()=>{
 const state={lastSuccess:{localDay:'2026-11-12',createdAt:'2026-11-12T10:00:00Z'},lastAttempt:{state:'failed',localDay:'2026-11-12',at:'2026-11-12T11:00:00Z'}};
 const alerts=nextBackupAlerts(state,at('2026-11-12T11:00:01Z'));assert.equal(alerts.active.kind,'failed');
 const next=nextBackupAlerts({...state,alerts,lastSuccessConfirmedAt:'2026-11-12T11:01:00Z',lastAttempt:{...state.lastAttempt,state:'succeeded'}},at('2026-11-12T11:01:01Z'));
 assert.equal(next.active,null);assert.equal(next.lastRecovery.incidentId,alerts.active.id);
});


test('email deployment validates one fixed recipient and requires an explicit sender before enabling its binding',()=>{
 assert.deepEqual(backupEmailConfigBlock({}),{});
 assert.deepEqual(backupEmailConfigBlock({vars:{BACKUP_ALERT_TO:'ops@example.test'}}),{vars:{BACKUP_ALERT_TO:'ops@example.test'}});
 const vars={BACKUP_ALERT_TO:'ops@example.test',BACKUP_ALERT_FROM:'backup@example.test'};
 assert.deepEqual(backupEmailConfigBlock({vars,send_email:[{name:'BACKUP_EMAIL',destination_address:'ops@example.test'}]}),{vars,send_email:[{name:'BACKUP_EMAIL',destination_address:'ops@example.test'}]});
 assert.throws(()=>backupEmailConfigBlock({vars:{BACKUP_ALERT_TO:'a@example.test\r\nBcc:other@example.test'}}));
 assert.throws(()=>backupEmailConfigBlock({vars:{BACKUP_ALERT_TO:'ops@example.test\n'}}));
 assert.throws(()=>backupEmailConfigBlock({vars:{...vars,ARBITRARY_SECRET:'no'}}));
 assert.throws(()=>backupEmailConfigBlock({vars,send_email:[{name:'BACKUP_EMAIL'}]}));
 assert.throws(()=>backupEmailConfigBlock({vars,send_email:[{name:'BACKUP_EMAIL',destination_address:'other@example.test'}]}));
 assert.throws(()=>backupEmailConfigBlock({vars:{BACKUP_ALERT_TO:'ops@example.test'},send_email:[{name:'BACKUP_EMAIL',destination_address:'ops@example.test'}]}));
});
