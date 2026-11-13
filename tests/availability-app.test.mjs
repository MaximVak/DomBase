import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { startAuthApp } from './support/auth-app-fixture.mjs';
import { seedSelfScheduleFixture } from './support/self-schedule-fixture.mjs';
import { loadServerModule } from '../scripts/server-runtime.mjs';

test('built Worker serves private Employee availability and retained review history across separate sessions', { timeout: 120000 }, async t => {
  const app = await startAuthApp({ seed: seedSelfScheduleFixture }); t.after(app.close);
  const call = (path, cookie = '', body) => fetch(app.origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Cookie: cookie, Connection: 'close', ...(body === undefined ? {} : { Origin: app.origin, 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const ok = async r => { const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body; };
  const login = async account => { const r = await call('/api/auth/login', '', { email: account.email, password: app.password }); await ok(r); return r.headers.get('set-cookie').split(';')[0]; };
  const f = app.fixtureData, first = await login(f.employeeAccount), second = await login(f.secondAccount), owner = await login(f.owner), path = '/api/self/availability';
  const page = await call('/me/availability', first); assert.equal(page.status, 200); assert.match(page.headers.get('cache-control'), /no-store/); assert.equal(page.headers.get('x-frame-options'), 'DENY'); assert.match(await page.text(), /My availability/);
  assert.equal((await call('/me/availability')).headers.get('location'), '/login');
  const initial = await ok(await call(path, first));
  const body = { id: randomBytes(32).toString('base64url'), contextToken: initial.contextToken, revision: initial.revision, effectiveDate: '2026-11-09', slots: [{ day: 'Thursday', preference: 'unavailable', startHour: 12.25, endHour: 14.5, location: 'This location' }], requestNote: 'Only first employee may see this note' };
  await ok(await call(path, first, body)); await ok(await call(path, first, body));
  const before = await ok(await call(path, first)); assert.equal(before.requests.length, 1); assert.equal(before.requests[0].status, 'pending'); assert.equal(before.current, null);
  assert.equal((await ok(await call(path, second))).requests.length, 0);
  assert.equal((await call(path + '?employeeId=' + f.a.id, second)).status, 400);
  assert.equal((await call('/api/workspace/state', first)).status, 401);
  assert.doesNotMatch(JSON.stringify(before), /password|pinHash|wageRates|amountCents|socialSecurity|Manager note/);
  const view = await ok(await call('/api/workspace/state', owner)), row = view.state.availabilityRequests.find(r => r.id === before.requests[0].id);
  const { saveBody } = await loadServerModule('workforce/changes.ts');
  await ok(await call('/api/workspace/commit', owner, saveBody(view, [{ entity: 'availability', id: row.id, before: row, after: { ...row, status: 'approved' } }], randomBytes(32).toString('base64url'))));
  const approved = await ok(await call(path, first)); assert.equal(approved.requests[0].status, 'approved'); assert.equal(approved.requests[0].decidedByName, f.owner.displayName); assert.equal(approved.requests[0].slots[0].startHour, 12.25);
  await ok(await call('/api/auth/logout', first, {})); assert.equal((await call(path, first)).status, 401);
  const fresh = await login(f.employeeAccount), history = await ok(await call(path, fresh)); assert.equal(history.requests[0].id, row.id); assert.equal(history.requests[0].status, 'approved');
  assert.equal((await call(path, fresh, { ...body, id: randomBytes(32).toString('base64url') })).status, 409);
  assert.equal((await call(path, owner)).status, 403);
});

test('approved availability uses effective date before recency, deterministic ties and every period in the day', async () => {
  const { approvedAvailability, availabilityForDate } = await loadServerModule('app/availability-model.ts');
  const base = { employeeId: 1, status: 'approved', slots: [{ day: 'Monday', startHour: 9.25, endHour: 12, preference: 'preferred' }, { day: 'Monday', startHour: 13, endHour: 17, preference: 'unavailable' }] };
  const rows = [
    { ...base, id: 1, effectiveDate: '2026-11-01', submittedAt: '2026-11-01T12:00:00Z' },
    { ...base, id: 2, effectiveDate: '2026-12-01', submittedAt: '2026-11-02T12:00:00Z' },
    { ...base, id: 3, effectiveDate: '2026-10-01', submittedAt: '2026-11-10T12:00:00Z' },
    { ...base, id: 4, effectiveDate: '2026-11-01', submittedAt: '2026-11-01T12:00:00.123Z' },
    { ...base, id: 5, effectiveDate: '2026-11-08', submittedAt: '2026-11-12T12:00:00Z', status: 'pending' },
    { ...base, id: 6, effectiveDate: '2026-11-08', submittedAt: '2026-11-12T12:00:00Z', status: 'rejected' },
  ];
  assert.equal(approvedAvailability(rows, 1, '2026-11-09').id, 4);
  assert.equal(approvedAvailability(rows, 1, '2026-12-01').id, 2);
  assert.equal(approvedAvailability(rows, 2, '2026-11-09'), undefined);
  assert.equal(availabilityForDate(rows, 1, '2026-11-09').slots.length, 2);
  assert.equal(availabilityForDate(rows, 1, '2026-11-10').slots.length, 0);
});
