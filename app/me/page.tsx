import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../auth/server";
import { MyProfileScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function MyProfilePage() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  if (account.accessLevel !== "employee") redirect("/");
  return <MyProfileScreen />;
}
