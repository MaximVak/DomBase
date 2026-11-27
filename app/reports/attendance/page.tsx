import type { ReportsAttendance } from "../../../workforce/reports-overview";
import { readReportPage } from "../read-report";
import type { ReportFilters } from "../read-report";
import { ReportFrame } from "../screen";
import { AttendanceDetail } from "./detail";
import "../reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsAttendancePage({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  const { report, ...form } = await readReportPage<ReportsAttendance>("reports-attendance", searchParams);
  return <ReportFrame active="attendance" scope={report} canCompare canViewLabor={report?.canViewLabor} {...form}>
    {report && <AttendanceDetail report={report} />}
  </ReportFrame>;
}
