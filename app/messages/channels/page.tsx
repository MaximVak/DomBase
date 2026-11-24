import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../../auth/server";
import { ChannelScreen } from "./screen";

export const dynamic = "force-dynamic";
export default async function CompanyChannelsPage({ searchParams }: { searchParams: Promise<{ channel?: string; post?: string }> }) {
  const account = await authenticatedAccount();
  if (!account) redirect("/login");
  const { channel, post } = await searchParams;
  const id = typeof post === "string" && /^[1-9]\d*$/.test(post) ? Number(post) : 0;
  return <ChannelScreen manager={account.accessLevel !== "employee"} initial={channel === "managers" ? "managers" : "company"}
    anchor={Number.isSafeInteger(id) && id > 0 ? id : undefined} />;
}
