import type { ReportsLabor } from "../../../workforce/reports-overview";
import { readReportPage } from "../read-report";
import type { ReportFilters } from "../read-report";
import { ReportFrame } from "../screen";
import { LaborDetail } from "./detail";
import "../reports.css";

export const dynamic = "force-dynamic";

export default async function ReportsLaborPage({ searchParams }: { searchParams: Promise<ReportFilters> }) {
  const { report, ...form } = await readReportPage<ReportsLabor>("reports-labor", searchParams);
  return <ReportFrame active="labor" scope={report} canCompare={Boolean(report?.canCompare)} canViewLabor {...form}>
    {report && <LaborDetail report={report} />}
  </ReportFrame>;
}
