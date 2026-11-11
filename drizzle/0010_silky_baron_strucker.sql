CREATE TABLE `recognition_preferences` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`share_birthday` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shoutout_moderation` (
	`shoutout_id` text PRIMARY KEY NOT NULL,
	`actor_account_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shoutout_id`) REFERENCES `team_shoutouts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team_shoutouts` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_employee_id` integer NOT NULL,
	`recipient_employee_id` integer NOT NULL,
	`actor_account_id` integer NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sender_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_shoutouts_people_check" CHECK("team_shoutouts"."sender_employee_id" <> "team_shoutouts"."recipient_employee_id"),
	CONSTRAINT "team_shoutouts_category_check" CHECK("team_shoutouts"."category" IN ('teamwork','helpfulness','customer_service','great_work')),
	CONSTRAINT "team_shoutouts_body_check" CHECK(length("team_shoutouts"."body") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `team_shoutouts_recipient_date_idx` ON `team_shoutouts` (`recipient_employee_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER team_shoutouts_no_update BEFORE UPDATE ON team_shoutouts BEGIN SELECT RAISE(ABORT, 'Recognition history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER team_shoutouts_no_delete BEFORE DELETE ON team_shoutouts BEGIN SELECT RAISE(ABORT, 'Recognition history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER shoutout_moderation_no_update BEFORE UPDATE ON shoutout_moderation BEGIN SELECT RAISE(ABORT, 'Recognition moderation is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER shoutout_moderation_no_delete BEFORE DELETE ON shoutout_moderation BEGIN SELECT RAISE(ABORT, 'Recognition moderation is append-only'); END;
