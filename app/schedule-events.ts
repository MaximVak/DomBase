export type ScheduleEvent = { id: number; date: string; title: string; notes: string };

export function validEventDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.getFullYear() > 0
    && `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === value;
}

export function normalizeScheduleEvents(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap(event => {
    if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || seen.has(event.id)
      || typeof event.date !== "string" || !validEventDate(event.date)
      || typeof event.title !== "string" || !event.title.trim()) return [];
    seen.add(event.id);
    return [{ id: event.id, date: event.date, title: event.title.trim().slice(0, 100), notes: typeof event.notes === "string" ? event.notes.slice(0, 500) : "" }];
  });
}

export function scheduleEventsForDate(events: ScheduleEvent[], date: string, enabled: boolean) {
  return enabled ? events.filter(event => event.date === date).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id) : [];
}
