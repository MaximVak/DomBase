ALTER TABLE schedule_publications ADD COLUMN shift_exchange INTEGER DEFAULT 0 NOT NULL CHECK(shift_exchange IN (0,1));
--> statement-breakpoint
CREATE TABLE shift_exchange_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 kind TEXT NOT NULL, status TEXT DEFAULT 'pending' NOT NULL,
 requester_id INTEGER NOT NULL REFERENCES employees(id),
 source_shift_id INTEGER NOT NULL REFERENCES shifts(id),
 source_fingerprint TEXT NOT NULL, source_snapshot TEXT NOT NULL,
 selected_employee_id INTEGER REFERENCES employees(id),
 offered_shift_id INTEGER REFERENCES shifts(id), offered_fingerprint TEXT, offered_snapshot TEXT,
 version INTEGER DEFAULT 1 NOT NULL, requested_at TEXT NOT NULL, accepted_at TEXT,
 decided_at TEXT, decided_by_account_id INTEGER REFERENCES accounts(id), reason TEXT DEFAULT '' NOT NULL,
 CONSTRAINT exchange_request_values_check CHECK (kind IN ('cover','trade') AND status IN ('pending','accepted','approved','declined','cancelled') AND version>0 AND (kind='trade' OR offered_shift_id IS NULL) AND (status NOT IN ('accepted','approved') OR (selected_employee_id IS NOT NULL AND (kind='cover' OR offered_shift_id IS NOT NULL))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX exchange_active_source_idx ON shift_exchange_requests(source_shift_id) WHERE status IN ('pending','accepted');
--> statement-breakpoint
CREATE INDEX exchange_requester_idx ON shift_exchange_requests(requester_id,id);
--> statement-breakpoint
CREATE TABLE shift_exchange_invitations (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, request_id INTEGER NOT NULL REFERENCES shift_exchange_requests(id),
 employee_id INTEGER NOT NULL REFERENCES employees(id), status TEXT DEFAULT 'pending' NOT NULL,
 version INTEGER DEFAULT 1 NOT NULL, responded_at TEXT,
 CONSTRAINT exchange_invitation_values_check CHECK (status IN ('pending','accepted','declined','closed') AND version>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX exchange_invitation_person_idx ON shift_exchange_invitations(request_id,employee_id);
--> statement-breakpoint
CREATE UNIQUE INDEX exchange_one_acceptance_idx ON shift_exchange_invitations(request_id) WHERE status='accepted';
--> statement-breakpoint
CREATE INDEX exchange_invitation_employee_idx ON shift_exchange_invitations(employee_id,id);
