ALTER TABLE location_settings ADD COLUMN min_rest_hours INTEGER NOT NULL DEFAULT 10 CHECK (min_rest_hours BETWEEN 0 AND 24);
--> statement-breakpoint
ALTER TABLE location_settings ADD COLUMN availability_review_days INTEGER NOT NULL DEFAULT 90 CHECK (availability_review_days BETWEEN 0 AND 365);
