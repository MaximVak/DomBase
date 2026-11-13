import assert from 'node:assert/strict';
import test from 'node:test';
import { loadServerModule } from '../scripts/server-runtime.mjs';
const { scheduledPaidMinutes, estimateSchedule } = await loadServerModule('app/schedule-estimates.ts');
const { defaultScheduleEnforcement: settings, normalizeScheduleEnforcement } = await loadServerModule('app/schedule-enforcement.ts');
const shift = (patch = {}) => ({ id: 1, employeeId: 1, date: '2026-11-09', start: '08:00', end: '17:00', role: 'Sales', ...patch });
const rate = (patch = {}) => ({ id: 1, roleId: 1, role: 'Sales', amountCents: 2000, basis: 'hourly', effectiveDate: '2026-01-01', ...patch });
const employees = rates => [{ id: 1, wageRates: rates }];
const context = { start: '2026-11-01', end: '2026-12-01', allDepartments: true };
const estimate = (shifts, rates = [rate()], config = settings, scope = context) => estimateSchedule(shifts, employees(rates), config, scope);
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

test('mandatory unpaid meals reduce scheduled minutes; 60-minute example and disabled meals work', () => {
  assert.equal(scheduledPaidMinutes([shift()], settings)[0].paidMinutes, 510);
  assert.equal(scheduledPaidMinutes([shift()], { ...settings, mealBreakMinutes: 60 })[0].paidMinutes, 480);
  assert.equal(scheduledPaidMinutes([shift()], { ...settings, mandatoryMealBreak: false })[0].paidMinutes, 540);
  assert.equal(scheduledPaidMinutes([shift({ end: '13:00' })], settings)[0].paidMinutes, 300);
  assert.equal(scheduledPaidMinutes([shift({ shiftType: 'day_off' })], settings)[0].paidMinutes, 0);
});
test('split gaps count as meals, adjacent role changes do not restart the meal allowance', () => {
  const a = shift({ end: '12:00' }), b = shift({ id: 2, start: '13:00', role: 'Stock' });
  assert.equal(sum(scheduledPaidMinutes([a, b], settings), 'paidMinutes'), 480);
  b.start = '12:00';
  const rows = scheduledPaidMinutes([b, a], settings);
  assert.equal(sum(rows, 'paidMinutes'), 510);
  assert.equal(rows.find(row => row.shiftId === 2).unpaidMinutes, 30);
});
test('long shifts get further meal allowances and arbitrary valid settings never create negative hours', () => {
  assert.equal(scheduledPaidMinutes([shift({ start: '06:00', end: '20:00' })], settings)[0].unpaidMinutes, 60);
  const rows = scheduledPaidMinutes([shift({ end: '09:01' })], { ...settings, mealBreakAfterHours: 1, mealBreakMinutes: 120 });
  assert.ok(rows[0].paidMinutes >= 0);
  assert.equal(normalizeScheduleEnforcement({ mealBreakMinutes: 0 }).mealBreakMinutes, 30);
  assert.equal(normalizeScheduleEnforcement({ mealBreakMinutes: 60 }).mealBreakMinutes, 60);
});
test('daily and weekly overtime add premiums once without counting daily OT towards the regular 40-hour cap', () => {
  const config = { ...settings, mandatoryMealBreak: false };
  const days = ['09','10','11','12','13'].map((day, i) => shift({ id: i+1, date: '2026-11-'+day }));
  const rows = estimate(days, [rate()], config);
  assert.equal(sum(rows, 'paidMinutes'), 45*60);
  assert.equal(sum(rows, 'overtimeMinutes'), 5*60);
  assert.equal(sum(rows, 'wagesCents'), 95000);
  days.push(shift({ id: 6, date: '2026-11-14', end: '12:00' }));
  assert.equal(sum(estimate(days, [rate()], config), 'overtimeMinutes'), 9*60);
  const long = estimate([shift({ start: '04:00', end: '18:00' })], [rate()], config)[0];
  assert.equal(long.overtimeMinutes, 240); assert.equal(long.doubleTimeMinutes, 120); assert.equal(long.wagesCents, 36000);
});
test('seventh consecutive workday uses 1.5x then 2x, but day off interrupts it', () => {
  const shifts = Array.from({ length: 7 }, (_, i) => shift({ id: i+1, date: '2026-11-'+String(9+i).padStart(2, '0'), end: i === 6 ? '18:00' : '09:00' }));
  const rows = estimate(shifts, [rate()], { ...settings, mandatoryMealBreak: false });
  assert.equal(rows[6].overtimeMinutes, 480); assert.equal(rows[6].doubleTimeMinutes, 120);
  shifts[3].shiftType = 'day_off';
  assert.equal(estimate(shifts, [rate()], { ...settings, mandatoryMealBreak: false })[6].overtimeMinutes, 120);
});
test('role and effective-date wages use a weighted weekly overtime rate, with no intermediate hour rounding', () => {
  const shifts = [shift({ end: '12:00' }), shift({ id: 2, start: '12:00', end: '18:00', role: 'Stock' })];
  const rows = estimate(shifts, [rate(), rate({ id: 2, roleId: 2, role: 'Stock', amountCents: 3000 }), rate({ id: 3, amountCents: 5000, effectiveDate: '2026-11-10' })], { ...settings, mandatoryMealBreak: false });
  assert.equal(sum(rows, 'wagesCents'), 28600); // $260 base + two OT hours × $26 × 0.5.
  assert.equal(sum(rows, 'overtimeMinutes'), 120);
  assert.equal(estimate([shift({ date: '2026-11-10', end: '09:01' })], [rate({ amountCents: 5000, effectiveDate: '2026-11-10' })])[0].wagesCents, 5083);
});
test('missing rates, partial weeks and scoped departments never produce a misleading complete wage total', () => {
  assert.equal(estimate([shift()], [])[0].wagesCents, null);
  assert.equal(estimate([shift()], [rate()], settings, { ...context, allDepartments: false })[0].wagesCents, null);
  assert.equal(estimate([shift()], [rate()], settings, { ...context, start: '2026-11-10' })[0].wagesCents, null);
  const rows = estimate([shift(), shift({ id: 2, role: 'Missing' })]);
  assert.ok(rows.every(row => row.wagesCents === null));
});
test('annual salary is explicitly a planning allocation, with overtime exempt only when recorded', () => {
  const shifts = [shift({ end: '18:00' })], config = { ...settings, mandatoryMealBreak: false };
  const exempt = estimate(shifts, [rate({ basis: 'annual_salary', amountCents: 8320000, overtimeExempt: true })], config)[0];
  assert.equal(exempt.wagesCents, 40000); assert.equal(exempt.overtimeMinutes, 0);
  assert.equal(estimate(shifts, [rate({ basis: 'annual_salary', amountCents: 8320000, overtimeExempt: false })], config)[0].wagesCents, 44000);
});
test('configured workweek handles December/January boundaries using complete context', () => {
  const row = estimate([shift({ date: '2027-01-01' })], [rate()], { ...settings, workWeekStart: 0 }, { ...context, start: '2026-12-27', end: '2027-01-02' })[0];
  assert.notEqual(row.wagesCents, null);
});
test('forecast meal changes affect only scheduled comparisons, never actual time or actual wages', async () => {
  const { buildTimeCards } = await loadServerModule('app/timesheets-model.ts');
  const input = { employees: [{ id: 1, name: 'Fictional worker', role: 'Sales', wage: '', active: true, wageRates: [rate()] }], shifts: [shift()], events: [
    { id: 1, employeeId: 1, type: 'in', at: '2026-11-09T08:00:00', role: 'Sales' },
    { id: 2, employeeId: 1, type: 'out', at: '2026-11-09T17:00:00', role: 'Sales' },
  ], adjustments: [], pto: [], start: '2026-11-09', end: '2026-11-15', now: Date.parse('2026-11-16T12:00:00'), rounding: 'actual', weekStart: 1, mandatoryMealBreak: true, mealBreakAfterHours: 5 };
  const original = structuredClone(input.events), a = buildTimeCards({ ...input, mealBreakMinutes: 30 }), b = buildTimeCards({ ...input, mealBreakMinutes: 60 });
  assert.equal(a[0].metrics.scheduled, 8.5); assert.equal(b[0].metrics.scheduled, 8);
  for (const key of ['actual', 'paid', 'regular', 'ot', 'doubleOt', 'wages', 'breaks']) assert.equal(a[0].metrics[key], b[0].metrics[key]);
  assert.deepEqual(input.events, original);
});
