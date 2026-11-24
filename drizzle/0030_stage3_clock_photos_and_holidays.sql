CREATE TABLE `clock_in_photos` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`ready_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `clock_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clock_in_photos_size_check" CHECK("clock_in_photos"."size_bytes" BETWEEN 1 AND 131072)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clock_in_photos_object_key_unique` ON `clock_in_photos` (`object_key`);--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_in_photos` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `holiday_pay_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `holiday_pay_multiplier` real DEFAULT 1.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `holidays` text DEFAULT '[]' NOT NULL;