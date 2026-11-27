import type { ReportsHours } from "../../../workforce/reports-overview";
import { readReportPage } from "../read-report";
import type { ReportFilters } from "../read-report";
import { ReportFrame } from "../screen";
import { HoursDetail } from "./detail";
import "../reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsHoursPage({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  const { report, ...form } = await readReportPage<ReportsHours>("reports-hours", searchParams);
  return <ReportFrame active="hours" scope={report} canCompare canViewLabor={report?.canViewLabor} {...form}>
    {report && <HoursDetail report={report} />}
  </ReportFrame>;
}
