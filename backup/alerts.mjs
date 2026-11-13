import { backupCalendar } from "./hosted-format.mjs";

export function previousBackupDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function expectedBackupDay(now) {
  const { day, hour } = backupCalendar(now);
  return hour >= 2 ? day : previousBackupDay(day);
}

// One persistent incident survives retries and reloads. Successful completion,
// rather than a running retry or a calendar rollover, is what resolves it.
export function nextBackupAlerts(state, now) {
  const { day, hour } = backupCalendar(now), expectedDay = expectedBackupDay(now);
  const success = state.lastSuccess, attempt = state.lastAttempt;
  const confirmedAt = success ? Math.max(Date.parse(success.createdAt), Date.parse(state.lastSuccessConfirmedAt ?? success.createdAt)) : 0;
  let active = state.alerts?.active ?? null, lastRecovery = state.alerts?.lastRecovery ?? null;
  if (active && success && (active.kind === "failed"
    ? success.localDay >= active.expectedDay && confirmedAt >= Date.parse(active.attemptAt)
    : success.localDay >= active.expectedDay)) {
    lastRecovery = { incidentId: active.id, kind: active.kind, detectedAt: active.detectedAt, recoveredAt: new Date(now).toISOString() };
    active = null;
  }
  const failed = attempt?.state === "failed" && (!success || Date.parse(attempt.at) > confirmedAt);
  // The daily job starts after 02:00 Pacific. Alert at 04:00 if today's
  // completion is missing; an older missing day is already overdue. Calendar
  // dates avoid the repeated/skipped hours around Pacific DST transitions.
  const stale = (!success || success.localDay < expectedDay)
    && (hour < 2 || hour >= 4 || (success && success.localDay < previousBackupDay(day)));
  const kind = failed ? "failed" : stale ? "stale" : null;
  if (kind) {
    if (!active) active = { id: `backup-${kind}-${failed ? attempt.at : expectedDay}`, kind, detectedAt: new Date(now).toISOString(), expectedDay, ...(failed ? { attemptAt: attempt.at } : {}) };
    else if (failed && active.kind !== "failed") active = { ...active, kind: "failed", attemptAt: attempt.at };
  }
  return { active, lastRecovery };
}
