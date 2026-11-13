ALTER TABLE location_settings ADD COLUMN meal_break_minutes INTEGER NOT NULL DEFAULT 30 CHECK (meal_break_minutes BETWEEN 30 AND 120);
