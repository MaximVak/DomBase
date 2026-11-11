import { redirect } from "next/navigation";
import { dashboardAccount } from "../../auth/server";
import { TeamScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function TeamPage() { if (!await dashboardAccount()) redirect("/login"); return <TeamScreen />; }
