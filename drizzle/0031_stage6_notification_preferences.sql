CREATE TABLE `account_notification_preferences` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`choices` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_notification_preferences_values_check" CHECK(json_valid("account_notification_preferences"."choices") AND json_type("account_notification_preferences"."choices") = 'object' AND "account_notification_preferences"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `in_app` integer DEFAULT true NOT NULL;