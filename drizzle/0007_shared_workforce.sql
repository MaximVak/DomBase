CREATE TABLE `notification_receipts` (
	`account_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`opened_at` text,
	`dismissed_at` text,
	PRIMARY KEY(`account_id`, `source_key`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workforce_commits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`body_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workforce_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workforce_state_singleton_check" CHECK("workforce_state"."id" = 1 AND "workforce_state"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `workforce_write_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`passed` integer NOT NULL,
	CONSTRAINT "workforce_write_checks_passed_check" CHECK("workforce_write_checks"."passed" = 1)
);

--> statement-breakpoint
INSERT INTO workforce_state (id, revision) VALUES (1, 0);
