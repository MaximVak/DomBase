// Convert the location's wall clock to UTC; do not use the operator's/device's zone.
export function zonedTimestamp(date: string, time: string, zone = "America/Los_Angeles") {
  const wanted = Date.parse(`${date}T${time}:00Z`); if (!Number.isFinite(wanted)) throw new Error("Invalid location time.");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let result = wanted;
  for (let index = 0; index < 4; index++) {
    const parts = formatter.formatToParts(new Date(result)); const part = (key: string) => parts.find(p => p.type === key)!.value;
    const actual = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}Z`);
    if (actual === wanted) return result; result += wanted - actual;
  }
  throw new Error("Location time does not exist.");
}
export function nextDate(date: string) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
