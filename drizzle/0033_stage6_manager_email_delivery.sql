CREATE TABLE `manager_email_deliveries` (
	`account_id` integer NOT NULL,
	`event` text NOT NULL,
	`occurrence` text NOT NULL,
	`target` text NOT NULL,
	`destination_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`account_id`, `event`, `occurrence`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "manager_email_values_check" CHECK("manager_email_deliveries"."event" IN ('lateArrival','noShow','managerOvertime','timeOffRequest','dailySummary','weeklySummary')
    AND "manager_email_deliveries"."state" IN ('pending','sending','accepted','uncertain','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `manager_email_queue_idx` ON `manager_email_deliveries` (`state`,`created_at`);