import Link from "next/link";
import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { TeamPermissionsPanel } from "../team-permissions";
export const dynamic = "force-dynamic";
export default async function AccountAccess() {
  const account = await dashboardAccount();
  if (!account) redirect("/login");
  return <main className="access-screen">
    <Link href="/">← Back to DomBase</Link>
    <header><h1>Account access</h1><p>{account.displayName}</p></header>
    <TeamPermissionsPanel />
  </main>;
}
