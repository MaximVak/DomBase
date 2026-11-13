CREATE TABLE `invitation_emails` (
	`invitation_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`next_attempt_at` text NOT NULL,
	`accepted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `team_invitations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitation_emails_state_check" CHECK("invitation_emails"."state" IN ('pending','sending','accepted','failed','cancelled')),
	CONSTRAINT "invitation_emails_attempts_check" CHECK("invitation_emails"."attempts" >= 0 AND "invitation_emails"."attempts" <= 4)
);
--> statement-breakpoint
CREATE INDEX `invitation_emails_due_idx` ON `invitation_emails` (`state`,`next_attempt_at`);