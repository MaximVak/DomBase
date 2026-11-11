import { redirect } from "next/navigation";
import { dashboardAccount } from "../../../auth/server";
import { TeamReportsScreen } from "./screen";
export const dynamic = "force-dynamic";
export default async function TeamReportsPage() { if (!await dashboardAccount()) redirect("/login"); return <TeamReportsScreen />; }
