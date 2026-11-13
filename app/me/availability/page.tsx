import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../../auth/server";
import { MyAvailabilityScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function MyAvailabilityPage() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  if (account.accessLevel !== "employee") redirect("/");
  return <MyAvailabilityScreen />;
}
