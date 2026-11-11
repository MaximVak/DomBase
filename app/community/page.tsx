import { redirect } from "next/navigation";
import { authenticatedAccount } from "../../auth/server";
import { CommunityScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function CommunityPage() { if (!await authenticatedAccount()) redirect("/login"); return <CommunityScreen />; }
