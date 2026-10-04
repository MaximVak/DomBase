"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export function SchedulingHourSelect({ label, value, endOfDay = false, onChange }: {
  label: string; value: number; endOfDay?: boolean; onChange: (hour: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeHour, setActiveHour] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const firstHour = endOfDay ? 1 : 0;
  const lastHour = endOfDay ? 24 : 23;
  const text = (hour: number) => hour === 24 ? "Midnight (end of day)" : `${hour % 12 || 12}:00 ${hour < 12 ? "am" : "pm"}`;

  useEffect(() => {
    if (!open) return;
    const option = list.current?.querySelector<HTMLButtonElement>(`[data-hour="${activeHour}"]`);
    option?.focus({ preventScroll: true });
    if (option && list.current) {
      const top = option.offsetTop;
      if (top < list.current.scrollTop || top + option.offsetHeight > list.current.scrollTop + list.current.clientHeight) {
        list.current.scrollTop = top - (list.current.clientHeight - option.offsetHeight) / 2;
      }
    }
  }, [open, activeHour]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function choose(hour: number) {
    onChange(hour);
    setOpen(false);
    trigger.current?.focus();
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape") {
      event.preventDefault(); setOpen(false); trigger.current?.focus(); return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setActiveHour(value); setOpen(true); return; }
    setActiveHour(current => event.key === "Home" ? firstHour : event.key === "End" ? lastHour
      : Math.min(lastHour, Math.max(firstHour, current + (event.key === "ArrowDown" ? 1 : -1))));
  }

  return <div className="scheduling-hour-select" ref={root} onKeyDown={keyboard}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="scheduling-hour-trigger" ref={trigger} aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setActiveHour(value); setOpen(current => !current); }}>
      <span>{text(value)}</span><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && <div className="scheduling-hour-options" id={id} role="listbox" aria-label={label} ref={list}>
      {Array.from({ length: 24 }, (_, index) => firstHour + index).map(hour => <button
        type="button" role="option" key={hour} data-hour={hour} tabIndex={-1}
        aria-selected={value === hour} onClick={() => choose(hour)}>{text(hour)}</button>)}
    </div>}
  </div>;
}
