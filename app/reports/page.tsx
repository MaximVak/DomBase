import type { ReportsOverview } from "../../workforce/reports-overview";
import { readReportPage } from "./read-report";
import type { ReportFilters } from "./read-report";
import { ReportsScreen } from "./screen";
import "./reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  return <ReportsScreen {...await readReportPage<ReportsOverview>("reports-overview", searchParams)} />;
}
