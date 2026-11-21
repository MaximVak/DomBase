import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../../auth/server";
import { AccountantExportScreen } from "./screen";
import "./styles.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accountant export | DomBase", robots: { index: false, follow: false } };

export default async function AccountantExportPage() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  if (account.accessLevel === "employee") redirect("/me");
  return <AccountantExportScreen />;
}
