import Link from "next/link";
import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { ownerBackupStatus } from "../../backup/server";
import type { BackupStatus } from "../../backup/status";
export const dynamic = "force-dynamic";
const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export default async function Backups() {
  const account = await dashboardAccount();
  if (!account) redirect("/login");
  if (account.accessLevel !== "owner") redirect("/");
  let status: BackupStatus | null = null;
  try { status = await ownerBackupStatus(); } catch { /* Visible unavailable state below. */ }
  const success = status?.lastSuccess; const failed = status?.lastAttempt?.state === "failed";
  return <main className="access-screen backup-screen">
    <Link href="/">← Back to DomBase</Link>
    <header><h1>Backups</h1><p>Daily recovery protection · Owner access</p></header>
    {!status ? <p role="alert">Backup status is unavailable. Reload this page shortly. A missing daily backup needs attention.</p>
      : !status.configured ? <p role="status">Automatic hosted backups are not configured in this environment.</p>
      : <>
        <section aria-labelledby="backup-health"><h2 id="backup-health">{failed ? "Backup failed — retry scheduled" : status.stale ? "Daily backup needs attention" : "Daily backup saved"}</h2>
          <p>{failed ? "The latest attempt failed. Previous completed backups remain available; the job retries after 15 minutes." : status.stale ? "A completed backup is missing for the expected day. Check again after the automatic retry." : "The latest daily database and file backup completed successfully."}</p>
          {status.lastAttempt && <p>Latest attempt: {status.lastAttempt.state} · <time dateTime={status.lastAttempt.at}>{date(status.lastAttempt.at)} Pacific</time></p>}
        </section>
        <section aria-labelledby="backup-latest"><h2 id="backup-latest">Last completed backup</h2>
          {success ? <dl className="backup-facts">
            <dt>Saved</dt><dd><time dateTime={success.createdAt}>{date(success.createdAt)} Pacific</time></dd>
            <dt>Contents</dt><dd>{success.tables} database tables · {success.objects} private files</dd>
            <dt>Schedule</dt><dd>{status.schedule}</dd>
            <dt>Retention</dt><dd>{status.retention}</dd>
            <dt>Protection</dt><dd>Encrypted in separate private storage</dd>
          </dl> : <p>No completed backup has been recorded yet.</p>}
        </section>
        <section aria-labelledby="backup-recovery"><h2 id="backup-recovery">Recovery key</h2><p>Keep the separate recovery file in your password manager and share a private copy with the company Owner. The key is required to recover these backups and is never displayed here.</p><p>Recovery is tested in a separate environment. This page cannot overwrite company data or download private files.</p></section>
        <Link href="/backups">Refresh backup status</Link>
      </>}
  </main>;
}
