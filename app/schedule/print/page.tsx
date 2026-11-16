import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../../auth/server";
import { SchedulePrintScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function SchedulePrintPage() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  return <SchedulePrintScreen employee={account.accessLevel === "employee"} />;
}
