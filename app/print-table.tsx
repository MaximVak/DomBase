import type { ReactNode } from "react";

// Keep a short table inside a normal block for print engines that split table
// rows or do not repeat thead. Screen tables keep their existing single header.
export function PrintTable({ header, rows, intro }: { header: ReactNode; rows: ReactNode[]; intro?: ReactNode }) {
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  return <>
    <table className="report-screen-table"><thead>{header}</thead><tbody>{rows}</tbody></table>
    <div className="report-print-groups" aria-hidden="true">
      {groups.map((group, index) => <div className="report-print-group" key={index}>
        {index === 0 ? intro : null}
        <table><thead>{header}</thead><tbody>{group}</tbody></table>
      </div>)}
    </div>
  </>;
}
