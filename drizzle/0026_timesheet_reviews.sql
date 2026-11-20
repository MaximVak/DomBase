CREATE TABLE `timesheet_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_key` text NOT NULL,
	`target_version` text NOT NULL,
	`employee_id` integer NOT NULL,
	`work_date` text NOT NULL,
	`actor_account_id` integer NOT NULL,
	`action` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "timesheet_reviews_action_check" CHECK("timesheet_reviews"."action" IN ('approve', 'resolve', 'no_show') AND ("timesheet_reviews"."action" != 'no_show' OR length(trim("timesheet_reviews"."reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timesheet_reviews_target_version_action_idx` ON `timesheet_reviews` (`target_key`,`target_version`,`action`);
--> statement-breakpoint
CREATE TRIGGER timesheet_reviews_no_update BEFORE UPDATE ON timesheet_reviews BEGIN
  SELECT RAISE(ABORT, 'Timesheet review history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER timesheet_reviews_no_delete BEFORE DELETE ON timesheet_reviews BEGIN
  SELECT RAISE(ABORT, 'Timesheet review history is append-only');
END;
