type ChannelState = "selected" | "off" | "unavailable";
type NotificationRow = { label: string; channels: [ChannelState, ChannelState, ChannelState]; reminder?: boolean };

const shiftNotifications: NotificationRow[] = [
  { label: "Schedule publication and updates", channels: ["selected", "selected", "off"] },
  { label: "Shift trade and cover request updates", channels: ["off", "selected", "off"] },
  { label: "Time off request responses", channels: ["off", "selected", "off"] },
  { label: "Open shift claim responses", channels: ["off", "selected", "off"] },
  { label: "Send me a reminder before my shift", channels: ["off", "selected", "off"], reminder: true },
  { label: "Clock out confirmation", channels: ["unavailable", "selected", "unavailable"] },
  { label: "Break end confirmation", channels: ["unavailable", "off", "unavailable"] },
  { label: "When I haven't clocked in after my shift starts", channels: ["unavailable", "selected", "selected"] },
  { label: "New tasks created on Task Manager", channels: ["unavailable", "selected", "unavailable"] },
  { label: "Tasks assigned to me are overdue", channels: ["unavailable", "selected", "unavailable"] },
];

const managerNotifications: NotificationRow[] = [
  { label: "Late employees", channels: ["off", "selected", "off"] },
  { label: "Overtime notifications", channels: ["off", "selected", "off"] },
  { label: "Employee trade, cover, open shift, and time off requests", channels: ["selected", "selected", "off"] },
  { label: "New job applicants received", channels: ["selected", "selected", "selected"] },
  { label: "Employee availability requests", channels: ["selected", "selected", "unavailable"] },
  { label: "Daily email summaries", channels: ["off", "unavailable", "unavailable"] },
  { label: "Weekly email summaries", channels: ["selected", "unavailable", "unavailable"] },
  { label: "Daily hiring summaries", channels: ["selected", "unavailable", "unavailable"] },
  { label: "Daily manager log updates", channels: ["selected", "unavailable", "unavailable"] },
  { label: "Tasks assigned to anyone on the team are overdue", channels: ["unavailable", "selected", "unavailable"] },
  { label: "Clock in reminders", channels: ["unavailable", "selected", "unavailable"] },
];

function NotificationGroup({ title, rows }: { title: string; rows: NotificationRow[] }) {
  return (
    <section className="notification-settings-group" aria-label={title}>
      <div className="notification-settings-grid notification-settings-group-heading">
        <h4>{title}</h4><span>Notification type</span>
      </div>
      {rows.map(row => (
        <div className="notification-settings-grid notification-settings-row" key={row.label}>
          {row.reminder ? <div className="notification-settings-reminder">
            <span>Send me a reminder</span>
            <input type="number" defaultValue={4} disabled aria-label="Hours before my shift" title="Not available yet" />
            <span>hour(s) before my shift</span>
          </div> : <span className="notification-settings-label">{row.label}</span>}
          <div className="notification-settings-channels">
            {(["Email", "Push", "Text"] as const).map((channel, index) => (
              <button type="button" disabled key={channel}
                className={`notification-settings-channel ${row.channels[index]}`}
                aria-label={`${row.label}: ${channel}`}
                aria-pressed={row.channels[index] === "selected"}
                title="Not available yet">{channel}</button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function NotificationsSettingsPanel({ locationName }: { locationName: string }) {
  return (
    <section className="panel settings-enforcement-panel settings-notifications-panel">
      <div className="settings-panel-heading"><h3>Notifications</h3><button type="button" disabled>Save</button></div>
      <p className="notification-settings-intro">Mobile app notifications for {" "}
        <button type="button" disabled title="Not available yet">iOS</button> and {" "}
        <button type="button" disabled title="Not available yet">Android</button>.
      </p>
      <div className="notification-settings-locations">
        <p id="notification-locations-label">Which locations would you like to receive notifications for?</p>
        <button type="button" disabled aria-labelledby="notification-locations-label" title="Not available yet">
          <span className="notification-settings-location-tag">{locationName}<span aria-hidden="true">⊗</span></span>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m3 6 5 5 5-5Z" fill="currentColor" /></svg>
        </button>
      </div>
      <NotificationGroup title="Shifts & schedule notifications" rows={shiftNotifications} />
      <NotificationGroup title="Manager alerts" rows={managerNotifications} />
    </section>
  );
}
