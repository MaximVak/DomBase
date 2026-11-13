/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the vinext RSC prefetch error. */
import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { TeamPermissionsPanel } from "../team-permissions";
export const dynamic = "force-dynamic";
export default async function AccountAccess() {
  const account = await dashboardAccount();
  if (!account) redirect("/login");
  return <main className="access-screen">
    <a href="/">← Back to DomBase</a>
    <header><h1>Account access</h1><p>{account.displayName}</p></header>
    <TeamPermissionsPanel />
  </main>;
}
