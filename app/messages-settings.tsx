import type { FormEvent } from "react";

export function MessagesSettingsPanel({ enabled, dirty, message, today, onChange, onSave }: {
  enabled: boolean;
  dirty: boolean;
  message: string;
  today: string;
  onChange: (enabled: boolean) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const end = new Date(`${today}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const formatDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <form className="panel settings-enforcement-panel settings-messages-panel" onSubmit={onSave}>
      <div className="settings-panel-heading">
        <h3>Messages</h3>
        <button type="submit" disabled={!dirty}>Save</button>
      </div>
      <div className="messages-settings-conversations">
        <h4>Location-level conversations (applies to all locations)</h4>
        <p>Control how team members communicate within their own location. Allow them to:</p>
        <div className="enforcement-rules">
          <div className="enforcement-rule">
            <label className="enforcement-rule-line messages-settings-unavailable" title="Not available yet">
              <input type="checkbox" checked disabled />
              <span>Give one another shout-outs</span>
            </label>
            <p>Lets team members recognize and celebrate coworkers.</p>
          </div>
          <div className="enforcement-rule">
            <label className="enforcement-rule-line">
              <input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)} />
              <span>Message one another</span>
            </label>
            <p>Enables 1:1 and group messages between employees and managers.</p>
          </div>
        </div>
      </div>
      <div className="messages-settings-download">
        <h4>Need to download message logs?</h4>
        <p>Choose the date range and conversations to download.</p>
        <div className="messages-settings-notice">
          <span className="messages-settings-info" aria-hidden="true">i</span>
          <span>Message log downloads are not available yet.</span>
          <button type="button" disabled title="Not available yet">Contact Support</button>
        </div>
        <div className="messages-settings-download-fields">
          <div>
            <label htmlFor="message-log-date-range">Date Range</label>
            <button id="message-log-date-range" type="button" disabled title="Not available yet">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              {formatDate(start)} – {formatDate(end)}
            </button>
          </div>
          <div>
            <label htmlFor="message-log-conversations">Conversations to Download</label>
            <select id="message-log-conversations" defaultValue="" disabled title="Not available yet"><option value="">Select</option></select>
            <p>Select up to 25 conversations to download messages.</p>
          </div>
        </div>
        <div className="messages-settings-download-actions"><button type="button" disabled title="Not available yet">Download</button></div>
      </div>
      {message ? <p className="enforcement-save-message" role="status">{message}</p> : null}
    </form>
  );
}
