import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../../auth/server";
import { MyTimeOffScreen } from "./screen";

export const dynamic = "force-dynamic";

export default async function MyTimeOffPage() {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  if (account.accessLevel !== "employee") redirect("/");
  return <MyTimeOffScreen />;
}
