"use client";
import { useSharedWorkspace } from "./shared-workspace";
import { NotificationPreferences } from "./schedule-alert-preferences";

export function NotificationsSettingsPanel() {
  const { refresh, setError } = useSharedWorkspace();
  return <section className="panel settings-enforcement-panel settings-notifications-panel">
    <div className="settings-panel-heading"><h3>Notifications</h3></div>
    <NotificationPreferences endpoint="/api/workspace/notification-preferences" onSaved={() => {
      void refresh().catch(() => setError("Preferences saved. Reload the workspace to refresh your notifications."));
    }} />
  </section>;
}
