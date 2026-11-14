ALTER TABLE schedule_publications ADD COLUMN department_id INTEGER REFERENCES departments(id);
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN period_start TEXT;
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN period_end TEXT;
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN notify_mode TEXT CHECK(notify_mode IS NULL OR notify_mode IN ('all','changed','none'));
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN notify_in_app INTEGER CHECK(notify_in_app IS NULL OR notify_in_app IN (0,1));
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN notify_email INTEGER CHECK(notify_email IS NULL OR notify_email IN (0,1));
--> statement-breakpoint
ALTER TABLE schedule_publications ADD COLUMN scope_departments TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scope_departments));
--> statement-breakpoint
CREATE TABLE schedule_notification_preferences (
 employee_id INTEGER PRIMARY KEY NOT NULL REFERENCES employees(id),
 in_app INTEGER NOT NULL DEFAULT 1,
 email INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT schedule_notification_preferences_values_check CHECK(in_app IN (0,1) AND email IN (0,1) AND version>0)
);
--> statement-breakpoint
CREATE TABLE schedule_emails (
 id TEXT PRIMARY KEY NOT NULL,
 publication_id INTEGER NOT NULL REFERENCES schedule_publications(id),
 recipient TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending',
 lease_token TEXT,
 lease_until TEXT,
 accepted_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT schedule_emails_state_check CHECK(state IN ('pending','sending','accepted','uncertain','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX schedule_emails_publication_recipient_idx ON schedule_emails(publication_id,recipient);
--> statement-breakpoint
CREATE INDEX schedule_emails_pending_idx ON schedule_emails(state,created_at);
--> statement-breakpoint
CREATE TABLE schedule_publication_recipients (
 publication_id INTEGER NOT NULL REFERENCES schedule_publications(id),
 employee_id INTEGER NOT NULL REFERENCES employees(id),
 in_app INTEGER NOT NULL,
 email_requested INTEGER NOT NULL,
 email_id TEXT REFERENCES schedule_emails(id),
 PRIMARY KEY(publication_id,employee_id),
 CONSTRAINT schedule_publication_recipients_flags_check CHECK(in_app IN (0,1) AND email_requested IN (0,1))
);
