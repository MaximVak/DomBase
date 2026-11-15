ALTER TABLE schedule_publications ADD COLUMN notice_type TEXT NOT NULL DEFAULT 'schedule' CHECK(notice_type IN ('schedule','open_shift_request'));
--> statement-breakpoint
CREATE TABLE open_shifts (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, role_id INTEGER NOT NULL REFERENCES roles(id),
 date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, station TEXT NOT NULL DEFAULT 'Floor', notes TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'blue',
 version INTEGER NOT NULL DEFAULT 1, publication_id INTEGER NOT NULL REFERENCES schedule_publications(id), created_by_account_id INTEGER NOT NULL REFERENCES accounts(id), filled_shift_id INTEGER REFERENCES shifts(id), archived_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT open_shifts_values_check CHECK(start_time<end_time AND version>0 AND color IN ('blue','green','amber','red','violet','gray'))
);
--> statement-breakpoint
CREATE INDEX open_shifts_date_idx ON open_shifts(date);
--> statement-breakpoint
CREATE UNIQUE INDEX open_shifts_filled_idx ON open_shifts(filled_shift_id);
--> statement-breakpoint
CREATE TABLE open_shift_draft_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, owner_account_id INTEGER NOT NULL REFERENCES accounts(id),client_key TEXT NOT NULL,
 open_shift_id INTEGER REFERENCES open_shifts(id),operation TEXT NOT NULL,role_id INTEGER NOT NULL REFERENCES roles(id),date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,
 station TEXT NOT NULL DEFAULT 'Floor',notes TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT 'blue',base_version INTEGER NOT NULL DEFAULT 0,base_publication_version INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT open_shift_draft_values_check CHECK(operation IN ('upsert','delete') AND (operation!='delete' OR open_shift_id IS NOT NULL) AND start_time<end_time AND base_version>=0 AND base_publication_version>=0 AND color IN ('blue','green','amber','red','violet','gray'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX open_shift_draft_owner_key_idx ON open_shift_draft_changes(owner_account_id,client_key);
--> statement-breakpoint
CREATE TABLE open_shift_claims (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,open_shift_id INTEGER NOT NULL REFERENCES open_shifts(id),employee_id INTEGER NOT NULL REFERENCES employees(id),status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,open_version INTEGER NOT NULL,
 requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,decided_at TEXT,decided_by_account_id INTEGER REFERENCES accounts(id),reason TEXT NOT NULL DEFAULT '',
 CONSTRAINT open_shift_claim_values_check CHECK(status IN ('pending','approved','declined','withdrawn','cancelled') AND version>0 AND open_version>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX open_shift_claim_pending_idx ON open_shift_claims(open_shift_id,employee_id) WHERE status='pending';
--> statement-breakpoint
CREATE UNIQUE INDEX open_shift_claim_approved_idx ON open_shift_claims(open_shift_id) WHERE status='approved';
--> statement-breakpoint
CREATE INDEX open_shift_claim_employee_idx ON open_shift_claims(employee_id,id);
--> statement-breakpoint
CREATE TABLE schedule_open_template_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,template_id INTEGER NOT NULL REFERENCES schedule_templates(id),role_id INTEGER NOT NULL REFERENCES roles(id),day_of_week INTEGER NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,station TEXT NOT NULL DEFAULT 'Floor',notes TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT 'blue',
 CONSTRAINT schedule_open_template_values_check CHECK(day_of_week BETWEEN 0 AND 6 AND start_time<end_time AND color IN ('blue','green','amber','red','violet','gray'))
);
--> statement-breakpoint
CREATE INDEX schedule_open_template_idx ON schedule_open_template_entries(template_id);
