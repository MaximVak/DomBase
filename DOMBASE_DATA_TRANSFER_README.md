# DomBase local data transfer

Transfer `dombase-local-data-2026-09-19.json` to the cloned DomBase project on the MacBook.

The JSON is an exact snapshot of the six browser `localStorage` records used by DomBase. It contains both:

- `localStorage`: the exact raw strings that must be restored under the same keys.
- `parsedData`: readable JSON copies for inspection or migration.

## Instructions for Codex on the MacBook

Restore every non-null entry from `backup.localStorage` to `window.localStorage` under its exact key while DomBase is running at the same local origin, then reload the app. Do not replace the data with starter/demo records. Validate the employee, shift, clock-event, PTO, conversation, and schedule-alert counts after restoration.

The primary record is `dombase-staff-state-v1`. It includes the roster, departments and roles, published shifts, per-manager schedule drafts, clock events, hour adjustments, time-off requests and policies, conversations, schedule publication alerts, and publication state.

The file also includes business/location settings plus opened and dismissed notification state.

## Privacy

This backup contains private employee information and PINs. Keep it local, transfer it directly, and do not commit or upload it to GitHub. The `outputs/` directory is already excluded by the repository's `.gitignore`.
