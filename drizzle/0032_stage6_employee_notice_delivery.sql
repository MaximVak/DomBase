CREATE TABLE `employee_notice_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` integer NOT NULL,
	`publication_id` integer,
	`shift_id` integer,
	`event` text NOT NULL,
	`channel` text NOT NULL,
	`destination_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication_id`) REFERENCES `schedule_publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employee_notice_values_check" CHECK("employee_notice_deliveries"."event" IN ('schedule','shiftStart','shiftEnd','clockOut','breakReminder','overtimeReminder')
    AND "employee_notice_deliveries"."state" IN ('pending','sending','accepted','uncertain','cancelled') AND "employee_notice_deliveries"."channel" IN ('sms','email')
    AND (("employee_notice_deliveries"."event"='schedule' AND "employee_notice_deliveries"."publication_id" IS NOT NULL AND "employee_notice_deliveries"."shift_id" IS NULL AND "employee_notice_deliveries"."channel"='sms')
      OR ("employee_notice_deliveries"."event"<>'schedule' AND "employee_notice_deliveries"."publication_id" IS NULL AND "employee_notice_deliveries"."shift_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX `employee_notice_queue_idx` ON `employee_notice_deliveries` (`state`,`channel`,`created_at`);--> statement-breakpoint
CREATE INDEX `employee_notice_publication_idx` ON `employee_notice_deliveries` (`publication_id`);