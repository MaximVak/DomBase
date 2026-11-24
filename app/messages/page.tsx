import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../auth/server";
import { TeamMessenger } from "./screen";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ conversation?: string | string[] }> }) {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  const { conversation } = await searchParams;
  const id = typeof conversation === "string" ? Number(conversation) : 0;
  return <TeamMessenger back={account.accessLevel === "employee" ? "/me" : "/"} initial={Number.isSafeInteger(id) && id > 0 ? id : undefined} />;
}
