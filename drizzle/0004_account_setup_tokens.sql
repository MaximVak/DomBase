CREATE TABLE `account_setup_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`issued_session_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_setup_tokens_token_hash_unique` ON `account_setup_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_setup_tokens_account_idx` ON `account_setup_tokens` (`account_id`);