ALTER TABLE `location_settings` ADD `break_premiums` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `meal_premium_limit` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `rest_premium_limit` integer DEFAULT 1 NOT NULL;