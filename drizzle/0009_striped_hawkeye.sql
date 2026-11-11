CREATE TABLE `employee_photos` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`employee_id`) REFERENCES `files`(`id`,`employee_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` integer NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`token_hash` text NOT NULL,
	`local_token_encrypted` text NOT NULL,
	`issued_by_account_id` integer NOT NULL,
	`issuer_version` integer NOT NULL,
	`acceptance_receipt` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_invitations_channel_check" CHECK("team_invitations"."channel" IN ('email', 'sms'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invitations_token_idx` ON `team_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `team_invitations_employee_idx` ON `team_invitations` (`employee_id`);--> statement-breakpoint
CREATE TABLE `team_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`pay_period` text DEFAULT 'weekly' NOT NULL,
	`anchor_date` text DEFAULT '2026-11-02' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "team_settings_period_check" CHECK("team_settings"."pay_period" IN ('weekly', 'biweekly', 'semimonthly', 'monthly'))
);
--> statement-breakpoint
ALTER TABLE `document_uploads` ADD `is_profile_photo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wage_rates` ADD `overtime_exempt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workforce_commits` ADD `attempt_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
INSERT INTO team_settings (id) VALUES (1);

--> statement-breakpoint
CREATE TRIGGER wage_rates_stage1_no_update BEFORE UPDATE ON wage_rates BEGIN SELECT RAISE(ABORT, 'Historical records are append-only'); END;

--> statement-breakpoint
CREATE TRIGGER wage_rates_stage1_no_delete BEFORE DELETE ON wage_rates BEGIN SELECT RAISE(ABORT, 'Historical records are append-only'); END;

--> statement-breakpoint
CREATE TRIGGER employment_history_stage1_no_update BEFORE UPDATE ON employment_history BEGIN SELECT RAISE(ABORT, 'Historical records are append-only'); END;

--> statement-breakpoint
CREATE TRIGGER employment_history_stage1_no_delete BEFORE DELETE ON employment_history BEGIN SELECT RAISE(ABORT, 'Historical records are append-only'); END;
