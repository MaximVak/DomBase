CREATE TABLE `kiosk_clock_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`interaction_id` text NOT NULL,
	`event_type` text NOT NULL,
	`role_id` integer,
	`shift_id` integer,
	`role_name` text DEFAULT '' NOT NULL,
	`previous_event_id` integer,
	`explanation` text DEFAULT '' NOT NULL,
	`requires_approval` integer NOT NULL,
	`approval_reason` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`interaction_id`) REFERENCES `kiosk_interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_event_id`) REFERENCES `clock_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kiosk_clock_requests_type_check" CHECK("kiosk_clock_requests"."event_type" IN ('in', 'out', 'break', 'break_end'))
);
--> statement-breakpoint
CREATE INDEX `kiosk_clock_requests_interaction_idx` ON `kiosk_clock_requests` (`interaction_id`);--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `kiosk_approval_sessions` ADD `session_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `kiosk_approval_sessions` ADD `credential_revision` text DEFAULT 'legacy-unenrolled' NOT NULL;--> statement-breakpoint
ALTER TABLE `kiosk_interactions` ADD `pin_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `manager_approval_credentials` ADD `revision` text DEFAULT 'legacy-unenrolled' NOT NULL;