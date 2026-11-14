CREATE TABLE schedule_templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 name TEXT NOT NULL,
 created_by_account_id INTEGER NOT NULL REFERENCES accounts(id),
 version INTEGER NOT NULL DEFAULT 1,
 archived_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT schedule_templates_values_check CHECK(length(trim(name)) BETWEEN 1 AND 100 AND version > 0)
);
--> statement-breakpoint
CREATE TABLE schedule_template_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 template_id INTEGER NOT NULL REFERENCES schedule_templates(id),
 employee_id INTEGER NOT NULL REFERENCES employees(id),
 role_id INTEGER NOT NULL REFERENCES roles(id),
 day_of_week INTEGER NOT NULL,
 start_time TEXT NOT NULL,
 end_time TEXT NOT NULL,
 shift_type TEXT NOT NULL DEFAULT 'work',
 color TEXT NOT NULL DEFAULT 'blue',
 station TEXT NOT NULL DEFAULT 'Floor',
 notes TEXT NOT NULL DEFAULT '',
 CONSTRAINT schedule_template_entries_values_check CHECK(day_of_week BETWEEN 0 AND 6 AND shift_type IN ('work','day_off') AND color IN ('blue','green','amber','red','violet','gray') AND ((shift_type='day_off' AND start_time='00:00' AND end_time='00:00') OR (shift_type='work' AND start_time<end_time)))
);
--> statement-breakpoint
CREATE INDEX schedule_template_entries_template_idx ON schedule_template_entries(template_id);
