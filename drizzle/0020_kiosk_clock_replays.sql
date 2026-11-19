CREATE TABLE `kiosk_clock_replays` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`role_id` integer,
	`event_type` text NOT NULL,
	`attempted_at` text NOT NULL,
	`explanation` text NOT NULL,
	`payload_hash` text NOT NULL,
	`event_id` integer,
	`received_at` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by_account_id` integer,
	FOREIGN KEY (`interaction_id`) REFERENCES `kiosk_interactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `clock_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kiosk_clock_replays_type_check" CHECK("kiosk_clock_replays"."event_type" IN ('in', 'out', 'break', 'break_end'))
);
--> statement-breakpoint
CREATE INDEX `kiosk_clock_replays_review_idx` ON `kiosk_clock_replays` (`event_id`,`reviewed_at`,`received_at`);
