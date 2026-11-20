ALTER TABLE `location_settings` ADD `overtime_daily_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_weekly_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_seventh_day_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_double_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_daily_hours` real DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_weekly_hours` real DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_double_hours` real DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_seventh_double_hours` real DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_multiplier` real DEFAULT 1.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `overtime_double_multiplier` real DEFAULT 2 NOT NULL;