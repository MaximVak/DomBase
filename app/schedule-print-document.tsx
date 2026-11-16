import type { SchedulePrintDocument as Document, PrintRow } from "./schedule-print-model";

function dateLabel(date: string) { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(date + "T12:00:00Z")); }
function rowGroups(rows: PrintRow[], columns: number) {
  const groups: PrintRow[][] = []; let group: PrintRow[] = [], lines = 0;
  const chars = Math.max(16, Math.floor(110 / columns));
  for (const row of rows) {
    const cost = Math.max(3, Math.ceil(row.name.length / 25) + 1, ...row.cells.map(cell => cell.reduce((n, entry) => n + [entry.text, entry.detail, entry.station].reduce((sum, text) => sum + Math.ceil(text.length / chars), 0) + (entry.draft ? 1 : 0) + 2, 0)));
    if (group.length && (group.length === 4 || lines + cost > 26)) { groups.push(group); group = []; lines = 0; }
    group.push(row); lines += cost;
  }
  if (group.length) groups.push(group);
  return groups;
}
export function SchedulePrintDocument({ data }: { data: Document }) {
  const status = data.draft ? "DRAFT - NOT PUBLISHED" : "Published schedule";
  return <article className="schedule-print-document" aria-label="Printable schedule">
    {data.sections.map((section, sectionIndex) => <section key={sectionIndex} aria-label={`${section.dates[0]} to ${section.dates.at(-1)}`}>
      {rowGroups(section.rows, section.dates.length).map((rows, index) => <div className="schedule-print-block" key={index}>
        <header><h2>{data.location} · Schedule</h2><strong>{status}</strong><p>{data.start} - {data.end} · {data.timeZone} · {data.scope}</p><small>Snapshot {new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(data.capturedAt))}{data.draft ? " · Includes your saved draft additions, edits and removals." : " · Published assignments only."}</small></header>
        <table><caption>{dateLabel(section.dates[0])} - {dateLabel(section.dates.at(-1)!)}{sectionIndex ? " · continued" : ""}</caption>
          <colgroup><col style={{ width: "18%" }} />{section.dates.map(date => <col key={date} />)}</colgroup>
          <thead><tr><th scope="col">Team member / row</th>{section.dates.map(date => <th scope="col" key={date}>{dateLabel(date)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{row.name}{row.continued ? " (continued)" : ""}</th>{row.cells.map((cell, day) => <td key={day}>{cell.length ? cell.map((entry, i) => <div className="schedule-print-entry" key={i}><strong>{entry.text}</strong>{entry.detail ? <span>{entry.detail}</span> : null}{entry.station ? <span>{entry.station}</span> : null}{entry.draft ? <b>Draft</b> : null}</div>) : <span className="schedule-print-empty">No entries</span>}</td>)}</tr>)}</tbody>
        </table>
      </div>)}
    </section>)}
    <p className="schedule-print-footnote">Times are local to {data.timeZone}. Overnight work ends on the next date. Open shifts are unassigned. Time off is shown as a reminder and does not remove conflicting work. Pay, private notes and leave reasons are excluded.</p>
  </article>;
}
