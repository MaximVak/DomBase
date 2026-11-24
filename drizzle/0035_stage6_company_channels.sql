CREATE TABLE `channel_announcement_recipients` (
	`post_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`read_at` text,
	`destination_hash` text,
	`expires_at` text,
	`state` text,
	`lease_token` text,
	`lease_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`post_id`, `account_id`),
	FOREIGN KEY (`post_id`) REFERENCES `channel_posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "announcement_email_values_check" CHECK(("channel_announcement_recipients"."state" IS NULL AND "channel_announcement_recipients"."destination_hash" IS NULL AND "channel_announcement_recipients"."expires_at" IS NULL)
    OR ("channel_announcement_recipients"."state" IS NOT NULL AND "channel_announcement_recipients"."state" IN ('pending','sending','accepted','uncertain','cancelled') AND "channel_announcement_recipients"."destination_hash" IS NOT NULL AND "channel_announcement_recipients"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `announcement_email_queue_idx` ON `channel_announcement_recipients` (`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `channel_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_key` text NOT NULL,
	`author_account_id` integer NOT NULL,
	`channel` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`pinned_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`author_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channel_posts_values_check" CHECK("channel_posts"."channel" IN ('company','managers') AND length(trim("channel_posts"."body")) BETWEEN 1 AND 4000
    AND (("channel_posts"."title" IS NOT NULL AND length(trim("channel_posts"."title")) BETWEEN 1 AND 120) OR ("channel_posts"."title" IS NULL AND "channel_posts"."pinned_at" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_posts_request_key_unique` ON `channel_posts` (`request_key`);--> statement-breakpoint
CREATE INDEX `channel_posts_timeline_idx` ON `channel_posts` (`channel`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `channel_posts_pins_idx` ON `channel_posts` (`pinned_at`);--> statement-breakpoint
ALTER TABLE `location_settings` ADD `enable_company_channels` integer DEFAULT true NOT NULL;