CREATE TABLE `timesheet_lock_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_key` text NOT NULL,
	`employee_id` integer,
	`role_id` integer,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`actor_account_id` integer NOT NULL,
	`action` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "timesheet_lock_events_valid_check" CHECK("timesheet_lock_events"."action" IN ('lock', 'unlock') AND "timesheet_lock_events"."start_date" <= "timesheet_lock_events"."end_date" AND "timesheet_lock_events"."starts_at" < "timesheet_lock_events"."ends_at" AND ("timesheet_lock_events"."employee_id" IS NOT NULL OR "timesheet_lock_events"."role_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `timesheet_lock_events_target_idx` ON `timesheet_lock_events` (`target_key`,`id`);
--> statement-breakpoint
CREATE INDEX `timesheet_lock_events_dates_idx` ON `timesheet_lock_events` (`start_date`,`end_date`);
--> statement-breakpoint
CREATE TRIGGER timesheet_lock_events_no_update BEFORE UPDATE ON timesheet_lock_events BEGIN
  SELECT RAISE(ABORT, 'Timesheet lock history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER timesheet_lock_events_no_delete BEFORE DELETE ON timesheet_lock_events BEGIN
  SELECT RAISE(ABORT, 'Timesheet lock history is append-only');
END;
