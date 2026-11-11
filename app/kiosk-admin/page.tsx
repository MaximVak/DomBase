import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { KioskAdminScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function KioskAdmin() {
  const account = await dashboardAccount();
  if (!account) redirect("/login");
  return <KioskAdminScreen />;
}
