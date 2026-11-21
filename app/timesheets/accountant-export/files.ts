import { timesheetCsv } from "../../timesheets-model";
import type { AccountantCell } from "../../../workforce/accountant-report";

export function accountantCsv(rows: AccountantCell[][]) {
  return timesheetCsv(rows.map(row => row.map(cell => typeof cell === "number" ? cell.toFixed(2) : cell)));
}

export async function accountantWorkbook(rows: AccountantCell[][]): Promise<ArrayBuffer> {
  if (rows.length > 65_536) throw new Error("This report is too large for Excel XLS. Use the CSV export.");
  const { utils, write } = await import("xlsx");
  const sheet = utils.aoa_to_sheet(rows);
  sheet["!cols"] = [30, 16, 26, 16, 16, 17, 12, 14, 24].slice(0, rows[0].length).map(wch => ({ wch }));
  for (let row = 1; row < rows.length; row++) {
    for (let col = 3; col < rows[row].length; col++) {
      const cell = sheet[utils.encode_cell({ r: row, c: col })];
      if (cell?.t === "n") cell.z = "0.00";
    }
  }
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, "Accountant timesheets");
  return write(workbook, { type: "array", bookType: "biff8" });
}
