"use client";
import { useEffect, useRef, useState } from "react";
import type { ReportedTime } from "../../kiosk/assistance";
import { kioskCopy } from "./copy";
import type { KioskLanguage } from "./copy";

export function AssistanceForm({ kind, language, date, busy, onSubmit, onBack }: {
  kind: "in" | "out"; language: KioskLanguage; date: string; busy: boolean;
  onSubmit: (time: ReportedTime, explanation: string) => void; onBack: () => void;
}) {
  const text = kioskCopy[language];
  const [day, setDay] = useState(date);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  return <form className="kiosk-report" onSubmit={event => {
    event.preventDefault();
    if (day && time && reason.trim() && !busy) onSubmit({ date: day, time }, reason);
  }}>
    <h2 ref={title} tabIndex={-1}>{kind === "in" ? text.assistedIn : text.assistedOut}</h2>
    <label>{text.actualDate}<input type="date" value={day} max={date} required onChange={event => setDay(event.target.value)} /></label>
    <label>{text.actualTime}<input type="time" step={1} value={time} required onChange={event => setTime(event.target.value)} /></label>
    <label>{text.assistanceReason}<textarea value={reason} required maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
    <div className="kiosk-actions">
      <button className="kiosk-primary" type="submit" disabled={busy || !day || !time || !reason.trim()}>{text.submitTime}</button>
      <button type="button" onClick={onBack} disabled={busy}>{text.back}</button>
    </div>
  </form>;
}
