import { redirect } from "next/navigation";
import { authenticatedAccount } from "../auth/server";
import { SharedWorkspace } from "./shared-workspace";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  if (account.accessLevel === "employee") redirect("/me");
  return <SharedWorkspace account={account} />;
}
