ALTER TABLE shifts ADD COLUMN shift_type TEXT NOT NULL DEFAULT 'work' CHECK (shift_type IN ('work','day_off'));
--> statement-breakpoint
ALTER TABLE shifts ADD COLUMN color TEXT NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','green','amber','red','violet','gray'));
--> statement-breakpoint
ALTER TABLE schedule_draft_changes ADD COLUMN shift_type TEXT NOT NULL DEFAULT 'work' CHECK (shift_type IN ('work','day_off'));
--> statement-breakpoint
ALTER TABLE schedule_draft_changes ADD COLUMN color TEXT NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','green','amber','red','violet','gray'));
