"use client";
// Use native navigation to avoid the vinext prefetch error.
import { useEffect, useRef, useState } from "react";
import { backupNotice, formatBackupTime } from "../backup/notice";
import type { BackupStatus } from "../backup/status";

export function BackupMonitor({ initialStatus = null, details = false }: { initialStatus?: BackupStatus | null; details?: boolean }) {
  const [status, setStatus] = useState(initialStatus), [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(false), [allowed, setAllowed] = useState(true);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, denied = false, active: AbortController | null = null;
    async function check() {
      if (disposed || denied || active || document.visibilityState === "hidden") return;
      const controller = new AbortController(); active = controller; setChecking(true);
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("/api/backups/status", { cache: "no-store", signal: controller.signal });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) { denied = true; setAllowed(false); setStatus(null); return; }
        if (!response.ok) throw new Error("Unavailable");
        const value = await response.json() as BackupStatus;
        if (!disposed) { setStatus(value); setUnavailable(false); }
      } catch { if (!disposed) setUnavailable(true); }
      finally { window.clearTimeout(timeout); active = null; if (!disposed) setChecking(false); }
    }
    const onVisible = () => { if (document.visibilityState !== "hidden") void check(); };
    refresh.current = () => { void check(); }; void check();
    const interval = window.setInterval(onVisible, 60000);
    window.addEventListener("focus", onVisible); document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; active?.abort(); window.clearInterval(interval); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  if (!allowed) return null;
  return <BackupMonitorView status={status} unavailable={unavailable} details={details} checking={checking} onRefresh={() => refresh.current()} />;
}

export function BackupMonitorView({ status, unavailable, details = false, checking = false, onRefresh }: {
  status: BackupStatus | null; unavailable: boolean; details?: boolean; checking?: boolean; onRefresh?: () => void;
}) {
  const notice = backupNotice(status, unavailable, details), success = status?.lastSuccess;
  if (!notice) return details ? <p role="status">Checking backup health…</p> : null;
  return <>
    <section className={`backup-alert backup-alert-${notice.tone}`} role={notice.tone === "warning" ? "alert" : "status"} aria-label="Backup protection">
      <div><h2>{notice.title}</h2><p>{notice.detail}</p>
        <p>{success ? <>Last successful backup: <time dateTime={success.createdAt}>{formatBackupTime(success.createdAt)} Pacific</time>.</> : "No completed backup has been confirmed."}</p>
      </div>
      {details ? <button type="button" disabled={checking} onClick={onRefresh}>{checking ? "Checking…" : "Check again"}</button> : <a href="/backups">View backup details</a>}
    </section>
    {details ? <>
      <p>Owners see these alerts in DomBase. Text alerts are not connected.</p>
      <p role={status?.email?.state === "retrying" || status?.email?.state === "unavailable" ? "alert" : "status"}>
        Email alerts{status?.email?.recipient ? <> to <strong>{status.email.recipient}</strong></> : ""}: {status?.email?.configured
          ? status.email.state === "retrying" ? "sending failed; another attempt is scheduled in 15 minutes."
          : status.email.state === "unavailable" ? "delivery status is unavailable."
          : status.email.state === "pending" ? "a notification is being prepared."
          : status.email.lastAcceptedAt ? <>last accepted by the email service <time dateTime={status.email.lastAcceptedAt}>{formatBackupTime(status.email.lastAcceptedAt)} Pacific</time>. Inbox receipt is not confirmed here.</>
          : "sending is configured; waiting for the next backup warning or recovery."
          : "not active yet. A verified sender and email service must be connected."}
      </p>
      <p>Daily backups start after 2:00 AM Pacific; a missing completion is overdue at 4:00 AM. A failed attempt raises a warning immediately.</p>
      <section aria-labelledby="backup-offsite"><h2 id="backup-offsite">Independent Backblaze copy</h2>
        <p role={status?.offsite?.state === "failed" ? "alert" : "status"}>{!status?.offsite ? "Copy status is unavailable."
          : !status.offsite.configured ? "Not connected yet. The Backblaze account and storage access are needed."
          : status.offsite.state === "failed" ? "The copy failed or is overdue. Automatic retries continue every 15 minutes; previous completed copies remain available."
          : status.offsite.state === "copying" ? "Copying and checking encrypted archive bytes."
          : status.offsite.stale || !status.offsite.lastSuccess ? "Waiting for the next completed daily copy."
          : "The latest daily archive was copied and its bytes verified."}</p>
        {status?.offsite?.lastSuccess ? <p>Last verified copy: <time dateTime={status.offsite.lastSuccess.createdAt}>{formatBackupTime(status.offsite.lastSuccess.createdAt)} Pacific</time> · backup day {status.offsite.lastSuccess.localDay}.</p> : null}
        <p>Backblaze keeps encrypted copies independently of Cloudflare. When connected, bucket lifecycle rules keep copies for 30 days. The separate recovery key is required to restore them.</p>
      </section>
      {status?.checkedAt ? <p>Last checked: <time dateTime={status.checkedAt}>{formatBackupTime(status.checkedAt)} Pacific</time>.</p> : null}
      {status?.configured ? <>
        {status.lastAttempt ? <p>Latest attempt: {status.lastAttempt.state} · <time dateTime={status.lastAttempt.at}>{formatBackupTime(status.lastAttempt.at)} Pacific</time></p> : null}
        <section aria-labelledby="backup-latest"><h2 id="backup-latest">Last completed backup</h2>
          {success ? <dl className="backup-facts"><dt>Saved</dt><dd>{formatBackupTime(success.createdAt)} Pacific</dd>
            <dt>Contents</dt><dd>{success.tables} database tables · {success.objects} private files</dd>
            <dt>Schedule</dt><dd>{status.schedule}</dd><dt>Retention</dt><dd>{status.retention}</dd>
            <dt>Protection</dt><dd>Encrypted in separate private storage</dd></dl> : <p>No completed backup has been recorded yet.</p>}
        </section>
        {status.alerts?.lastRecovery ? <p>Last warning cleared: <time dateTime={status.alerts.lastRecovery.recoveredAt}>{formatBackupTime(status.alerts.lastRecovery.recoveredAt)} Pacific</time>.</p> : null}
      </> : null}
    </> : null}
  </>;
}
