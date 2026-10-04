const permissionRows = [
  { id: "account-plan", label: "Who can upgrade and downgrade this account?" },
  { id: "employee-wages", label: "Who can view all employee wages?", peerWages: true },
  { id: "labor-costs", label: "Who can see labor costs and labor cost %?" },
  { id: "shift-notes", label: "Who can add and view notes to shifts?" },
  { id: "departments-roles", label: "Who can create and edit Departments and Roles?" },
  { id: "company-reports", label: "Who can view company reports and sales data on the web dashboard?" },
  { id: "availability-requests", label: "Who can approve availability requests?" },
  { id: "summary-emails", label: "Who can receive the daily timesheets and weekly sales summary emails?" },
  { id: "permission-settings", label: "Who has access to and can edit this permissions page?" },
  { id: "employee-documents", label: "Who can access completed employee documents such as W-4s, I-9s, state tax forms, and others?", manager: false },
  { id: "hiring", label: "Who can view and manage hiring features, including paid postings, on the web dashboard?" },
  { id: "other-settings", label: "Who has access to and can edit other settings pages?" },
  { id: "employee-management", label: "Who can view, edit, or terminate employees?" },
  { id: "team-schedules", label: "Who can create and edit team schedules on the web dashboard or from the mobile app?" },
  { id: "manager-log", label: "Who can view and contribute to the manager log?" },
  { id: "timesheets", label: "Who can view and make changes to existing timesheets on the web dashboard?" },
  { id: "timecard-locks", label: "Who can lock and unlock time cards?", manager: false },
];

export function TeamPermissionsPanel() {
  return (
    <section className="panel settings-enforcement-panel settings-team-permissions-panel">
      <div className="settings-panel-heading">
        <h3>Team permissions</h3>
        <button type="button" disabled>Save</button>
      </div>
      <p className="team-permissions-intro">DomBase makes it simple to schedule, track, and manage employees. Review what permissions your team members have access to.</p>
      <div className="team-permissions-feature" title="Not available yet">
        <h4>Multiple wage rates</h4>
        <p>Apply different wage rates to different roles for team members</p>
      </div>
      <div className="team-permissions-feature">
        <h4>Departments</h4>
        <p>Track labor costs by area and allow department-level managers to create and publish schedules for their departments.</p>
      </div>
      <div className="team-permissions-access-levels">
        <h4>Access levels on DomBase:</h4>
        <p><strong>Account Owner</strong> oversees the account and is identified in the team roster.</p>
        <p><strong>Admins</strong> have access to team management and administrative controls.</p>
        <p><strong>Managers</strong> can manage team schedules, employees, timesheets, and settings.</p>
        <p><strong>Employees</strong> have access to their time clock, timesheets, and time off requests.</p>
      </div>
      <table className="team-permissions-table">
        <thead>
          <tr><th scope="col">Permissions</th><th scope="col">Admin</th><th scope="col">Manager</th></tr>
        </thead>
        <tbody>
          {permissionRows.map(row => (
            <tr key={row.id}>
              <th scope="row">
                <span>{row.label}</span>
                {row.peerWages ? (
                  <label className="team-permissions-peer-wages" title="Not available yet">
                    <input type="checkbox" disabled />
                    <span>Prevent managers from viewing equivalent managers&apos; wages (i.e., Admins can&apos;t see other Admins&apos; wages)</span>
                  </label>
                ) : null}
              </th>
              <td><input type="checkbox" checked disabled aria-label={`Admin: ${row.label}`} title="Not available yet" /></td>
              <td><input type="checkbox" checked={row.manager !== false} disabled aria-label={`Manager: ${row.label}`} title="Not available yet" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
