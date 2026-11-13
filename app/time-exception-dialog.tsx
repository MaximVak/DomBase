"use client";

import { useEffect, useRef } from "react";
import type { FormEvent } from "react";

export function TimeExceptionDialog({ message, explanation, limit, onExplanation, onCancel, onSubmit }: {
  message: string; explanation: string; limit: number;
  onExplanation: (value: string) => void; onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector("textarea")?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  function cancel() { ref.current?.close(); onCancel(); }
  return <dialog ref={ref} className="time-exception-modal" aria-labelledby="time-exception-title"
    aria-describedby="time-exception-warning" onCancel={event => { event.preventDefault(); cancel(); }}>
    <form onSubmit={onSubmit}>
      <div className="modal-heading"><div><p className="eyebrow">Warning</p><h2 id="time-exception-title">Supervisor Approval Required</h2></div>
        <button type="button" className="time-exception-close" aria-label="Close supervisor approval" onClick={cancel}>×</button>
      </div>
      <p id="time-exception-warning" className="time-exception-warning">{message} This is a warning and is subject for approval with the supervisor.</p>
      <textarea value={explanation} onChange={event => onExplanation(event.target.value)} placeholder="Enter explanation"
        aria-label="Time exception explanation" maxLength={limit} required />
      <p className="character-count" aria-live="polite">{limit - explanation.length} characters remaining</p>
      <div className="time-exception-actions"><button type="button" onClick={cancel}>Cancel</button>
        <button type="submit" className="primary-action" disabled={!explanation.trim()}>Submit explanation</button></div>
    </form>
  </dialog>;
}
