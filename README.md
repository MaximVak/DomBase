# DomBase

DomBase is an employee scheduling and time-tracking app that brings shifts,
attendance, time off, and team communication into one workspace. Managers can
organize their team and review attendance, while employees can check their
schedules, track their hours, and request time off.

The app supports desktop and mobile layouts, with separate manager and employee
views accessed through a four-digit PIN.

## What It Does

### Scheduling

- View shifts by day, week, or month.
- Create and edit shifts with start and end times, roles, work stations, and notes.
- Apply a shift to multiple days and keep changes as drafts before publishing.
- Add events to the schedule and show approved time off alongside shifts.
- Let employees submit preferred work hours and unavailable times for manager review.

### Time Tracking

- Clock in and out, take breaks, and see a live break countdown.
- Check attendance against scheduled shifts and collect explanations for time exceptions.
- Review clock-ins, clock-outs, breaks, and missed shifts in the Events tab.
- View daily, weekly, and monthly timesheets with break-adjusted totals, time rounding, and overtime indicators.
- Let managers adjust recorded hours while employees can view their own totals.

### Team Management

- Maintain a searchable employee roster with contact details, roles, wages, locations, and access levels.
- Organize departments and roles, including multiple managers per department.
- Keep employee profiles, manager notes, certificate attachments, and certificate expiration dates.
- Record employee termination and rehire history.
- Copy, download, or print the team roster.

### Time Off and Communication

- Submit paid or unpaid time-off requests with a reason and explanation.
- Let managers approve or deny requests and review request history.
- Set up time-off policies with starting balances and fixed or earned allowances.
- Send individual and group messages within the app.
- See in-app notifications for requests, schedule updates, and attendance alerts.

### Settings

Managers can update business information and choose rules for clock-in timing,
required explanations, missed-shift alerts, automatic clock-outs, breaks,
schedule visibility, department scheduling permissions, and availability approval.

## Manager and Employee Views

**Managers** can manage the roster, build schedules, review attendance and
timesheets, handle time-off requests, and configure workplace rules.

**Employees** can view schedules, clock in and out, track breaks, review their
hours, submit availability and time-off requests, update personal profiles,
and message their team.

## Current Status

DomBase is a working, local-first prototype. Records and uploaded certificates
are saved in the browser on the device being used. They are not automatically
shared between devices or users. Pulling this repository updates the app's code,
not its saved employee records.

Some settings are placeholders for future work. Payroll processing, POS
connections, external email or text notifications, and two-step verification
are not implemented. PIN access is intended for the prototype, not secure
production storage of sensitive employee information.

## Run Locally

With Node.js 22.13 or newer installed, run:

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. On a fresh setup, the manager PIN
is `0000`; managers can add employees and assign their PINs in the roster.

To check a production build, run `npm run build`.
