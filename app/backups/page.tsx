/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the vinext RSC prefetch error. */
import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { ownerBackupStatus } from "../../backup/server";
import type { BackupStatus } from "../../backup/status";
import { BackupMonitor } from "../backup-monitor";
export const dynamic = "force-dynamic";
export default async function Backups() {
  const account = await dashboardAccount();
  if (!account) redirect("/login");
  if (account.accessLevel !== "owner") redirect("/");
  let status: BackupStatus | null = null;
  try { status = await ownerBackupStatus(); } catch { /* Visible unavailable state below. */ }
  return <main className="access-screen backup-screen">
    <a href="/">← Back to DomBase</a>
    <header><h1>Backups</h1><p>Daily recovery protection · Owner access</p></header>
    <BackupMonitor initialStatus={status} details />
    <section aria-labelledby="backup-recovery"><h2 id="backup-recovery">Recovery key</h2><p>Keep the separate recovery file in your password manager and share a private copy with the company Owner. The key is required to recover these backups and is never displayed here.</p><p>Recovery is tested in a separate environment. This page cannot overwrite company data or download private files.</p></section>
  </main>;
}
