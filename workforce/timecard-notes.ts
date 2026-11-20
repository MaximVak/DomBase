import type { ClockEvent, TimeCardNote } from "./model";

export function timeCardNotes(events: Pick<ClockEvent, "carriedNotes" | "explanation" | "noteAuthor">[]): TimeCardNote[] {
  const notes = new Map<string, TimeCardNote>();
  for (const event of events) {
    for (const note of event.carriedNotes ?? []) notes.set(`${note.author}:${note.text}`, note);
    if (event.explanation) {
      const note: TimeCardNote = { author: event.noteAuthor ?? "recorded", text: event.explanation };
      notes.set(`${note.author}:${note.text}`, note);
    }
  }
  return [...notes.values()];
}
