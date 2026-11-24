CREATE TABLE `message_attachments` (
	`file_id` text PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`message_id` integer,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`,`conversation_id`) REFERENCES `messages`(`id`,`conversation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_attachments_message_idx` ON `message_attachments` (`conversation_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `message_attachments_expiry_idx` ON `message_attachments` (`message_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `message_mentions` (
	`message_id` integer NOT NULL,
	`conversation_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`name` text NOT NULL,
	`notified` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`message_id`, `employee_id`),
	FOREIGN KEY (`message_id`,`conversation_id`) REFERENCES `messages`(`id`,`conversation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`,`employee_id`) REFERENCES `conversation_members`(`conversation_id`,`employee_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_mentions_employee_idx` ON `message_mentions` (`employee_id`,`conversation_id`);