CREATE TABLE `document_uploads` (
	`file_id` text PRIMARY KEY NOT NULL,
	`body_hash` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`certificate_id` integer,
	`expiration_date` text,
	`employee_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_upload_kind_check" CHECK("document_uploads"."kind" IN ('certificate', 'onboarding'))
);
--> statement-breakpoint
CREATE TABLE `onboarding_document_files` (
	`employee_id` integer NOT NULL,
	`document_name` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_id`, `document_name`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`employee_id`) REFERENCES `files`(`id`,`employee_id`) ON UPDATE no action ON DELETE no action
);
