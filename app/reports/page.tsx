import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLoopback } from "../../auth/http";
import { handleWorkspace } from "../../workforce/server";
import type { ReportsOverview } from "../../workforce/reports-overview";
import { ReportsScreen } from "./screen";
import "./reports.css";

export const dynamic = "force-dynamic";

type Filters = Record<string, string | string[] | undefined>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const [incoming, params] = await Promise.all([headers(), searchParams]);
  const url = new URL("/api/workspace/reports-overview", `https://${incoming.get("host") ?? "invalid"}`);
  if (isLoopback(url.hostname)) url.protocol = "http:";
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) url.searchParams.append(key, entry);
  }
  const response = await handleWorkspace(new Request(url, { headers: { Cookie: incoming.get("cookie") ?? "" } }));
  if (response.status === 401) redirect("/login");
  if (response.status === 403) redirect("/");
  if (!response.ok) {
    const { error } = await response.json() as { error: string };
    return <ReportsScreen error={error} start={typeof params.start === "string" ? params.start : ""} end={typeof params.end === "string" ? params.end : ""} />;
  }
  const report = await response.json() as ReportsOverview;
  return <ReportsScreen report={report} start={report.period.start} end={report.period.end} />;
}
