CREATE TABLE `assisted_clock_reports` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`requested_at` text NOT NULL,
	`submitted_at` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`decided_at` text,
	`decided_by_account_id` integer,
	`decided_time` text,
	FOREIGN KEY (`event_id`) REFERENCES `clock_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assisted_clock_reports_request_id_unique` ON `assisted_clock_reports` (`request_id`);--> statement-breakpoint
CREATE INDEX `assisted_clock_reports_pending_idx` ON `assisted_clock_reports` (`status`,`submitted_at`);--> statement-breakpoint
ALTER TABLE `location_settings` ADD `late_attendance_alerts` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `assisted_clock_in` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `assisted_clock_out` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_out_reminders` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_out_reminder_email` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_out_reminder_first` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_out_reminder_second` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `clock_out_reminder_third` integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `clock_email_state` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `clock_email_claimed_at` text;--> statement-breakpoint
CREATE INDEX `notifications_clock_email_idx` ON `notifications` (`clock_email_state`,`occurred_at`);