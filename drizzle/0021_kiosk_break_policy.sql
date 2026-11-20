ALTER TABLE `clock_events` ADD `clock_details` text;--> statement-breakpoint
ALTER TABLE `kiosk_clock_replays` ADD `action_details` text;--> statement-breakpoint
ALTER TABLE `kiosk_clock_requests` ADD `action_details` text;--> statement-breakpoint
ALTER TABLE `kiosk_clock_requests` ADD `clock_details` text;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `block_early_clock_in` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `block_early_break_return` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `break_waivers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `missed_break_reports` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `unpaid_rest_overage` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `location_settings` ADD `paid_rest_minutes` integer DEFAULT 10 NOT NULL;
