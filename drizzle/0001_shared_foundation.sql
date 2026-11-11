CREATE TABLE `account_permissions` (
	`account_id` integer NOT NULL,
	`permission` text NOT NULL,
	`allowed` integer NOT NULL,
	PRIMARY KEY(`account_id`, `permission`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_permissions_allowed_check" CHECK("account_permissions"."allowed" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`session_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_sessions_token_hash_unique` ON `account_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_sessions_account_expiry_idx` ON `account_sessions` (`account_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text NOT NULL,
	`access_level` text DEFAULT 'employee' NOT NULL,
	`password_hash` text,
	`login_enabled` integer DEFAULT false NOT NULL,
	`disabled_at` text,
	`session_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_access_check" CHECK("accounts"."access_level" IN ('owner', 'general_manager', 'manager', 'employee')),
	CONSTRAINT "accounts_email_check" CHECK("accounts"."normalized_email" = lower(trim("accounts"."email")) AND length("accounts"."normalized_email") > 0),
	CONSTRAINT "accounts_login_check" CHECK("accounts"."login_enabled" IN (0, 1) AND ("accounts"."login_enabled" = 0 OR ("accounts"."password_hash" IS NOT NULL AND length("accounts"."password_hash") > 0)) AND "accounts"."session_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_idx` ON `accounts` (`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_employee_idx` ON `accounts` (`employee_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_account_id` integer,
	`employee_id` integer,
	`device_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `kiosk_devices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_metadata_check" CHECK(json_valid("audit_log"."metadata"))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`blocked_until` text,
	CONSTRAINT "auth_rate_limits_count_check" CHECK("auth_rate_limits"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE `availability_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`decision` text NOT NULL,
	`actor_account_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `availability_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "availability_decisions_value_check" CHECK("availability_decisions"."decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `availability_decisions_request_idx` ON `availability_decisions` (`request_id`);--> statement-breakpoint
CREATE TABLE `availability_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_note` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`decided_by_account_id` integer,
	`rejection_note` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "availability_requests_status_check" CHECK("availability_requests"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `availability_requests_employee_effective_idx` ON `availability_requests` (`employee_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `availability_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`preference` text NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `availability_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "availability_slots_range_check" CHECK("availability_slots"."day_of_week" BETWEEN 0 AND 6 AND "availability_slots"."start_minute" BETWEEN 0 AND 1439 AND "availability_slots"."end_minute" BETWEEN 1 AND 1440 AND "availability_slots"."start_minute" < "availability_slots"."end_minute" AND "availability_slots"."preference" IN ('preferred', 'unavailable'))
);
--> statement-breakpoint
CREATE INDEX `availability_slots_request_idx` ON `availability_slots` (`request_id`);--> statement-breakpoint
CREATE TABLE `business` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`company_name` text NOT NULL,
	`location_name` text NOT NULL,
	`primary_owner_account_id` integer,
	`location_phone` text DEFAULT '' NOT NULL,
	`company_phone` text DEFAULT '' NOT NULL,
	`address1` text DEFAULT '' NOT NULL,
	`address2` text DEFAULT '' NOT NULL,
	`city` text DEFAULT 'Sacramento' NOT NULL,
	`state_province` text DEFAULT 'California' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`country` text DEFAULT 'United States' NOT NULL,
	`time_zone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`business_type` text DEFAULT '' NOT NULL,
	`business_category` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`primary_owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "business_single_location_check" CHECK("business"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `conversation_members` (
	`conversation_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`left_at` text,
	PRIMARY KEY(`conversation_id`, `employee_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversation_members_employee_idx` ON `conversation_members` (`employee_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator_employee_id` integer NOT NULL,
	`name` text,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`creator_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `department_managers` (
	`department_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	PRIMARY KEY(`department_id`, `account_id`),
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `department_managers_account_idx` ON `department_managers` (`account_id`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name_unique` ON `departments` (`name`);--> statement-breakpoint
CREATE TABLE `device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `kiosk_devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_sessions_token_hash_unique` ON `device_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `device_sessions_device_expiry_idx` ON `device_sessions` (`device_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `employee_certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`name` text NOT NULL,
	`expiration_date` text,
	`file_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`employee_id`) REFERENCES `files`(`id`,`employee_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `employee_certificates_employee_expiration_idx` ON `employee_certificates` (`employee_id`,`expiration_date`);--> statement-breakpoint
CREATE TABLE `employee_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`author_account_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `employee_notes_employee_idx` ON `employee_notes` (`employee_id`);--> statement-breakpoint
CREATE TABLE `employee_profiles` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`legal_first_name` text DEFAULT '' NOT NULL,
	`legal_middle_name` text DEFAULT '' NOT NULL,
	`legal_last_name` text DEFAULT '' NOT NULL,
	`date_of_birth` text,
	`ssn_encrypted` text,
	`home_address` text DEFAULT '' NOT NULL,
	`home_address_line2` text DEFAULT '' NOT NULL,
	`home_city` text DEFAULT '' NOT NULL,
	`home_state_province` text DEFAULT '' NOT NULL,
	`home_postal_code` text DEFAULT '' NOT NULL,
	`emergency_contact` text DEFAULT '' NOT NULL,
	`emergency_contact_relationship` text DEFAULT '' NOT NULL,
	`emergency_contact_phone` text DEFAULT '' NOT NULL,
	`emergency_contact_preference` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee_roles` (
	`employee_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_id`, `role_id`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee_settings` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`show_in_schedule` integer DEFAULT true NOT NULL,
	`send_location_alerts` integer DEFAULT true NOT NULL,
	`include_in_time_clock_errors` integer DEFAULT true NOT NULL,
	`eligible_for_open_shifts` integer DEFAULT true NOT NULL,
	`can_waive_missed_breaks` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employment_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`date` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor_account_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "employment_history_type_check" CHECK("employment_history"."event_type" IN ('terminated', 'rehired'))
);
--> statement-breakpoint
CREATE INDEX `employment_history_employee_date_idx` ON `employment_history` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` integer NOT NULL,
	`uploaded_by_account_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "files_size_status_check" CHECK("files"."size_bytes" >= 0 AND "files"."status" IN ('pending', 'ready', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_unique` ON `files` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_id_employee_idx` ON `files` (`id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `files_employee_idx` ON `files` (`employee_id`);--> statement-breakpoint
CREATE TABLE `hours_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`adjustment_seconds` integer NOT NULL,
	`actor_account_id` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hours_adjustments_employee_date_idx` ON `hours_adjustments` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `kiosk_approval_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_session_id` text NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`device_session_id`) REFERENCES `device_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosk_approval_sessions_token_hash_unique` ON `kiosk_approval_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `kiosk_approval_sessions_device_idx` ON `kiosk_approval_sessions` (`device_session_id`);--> statement-breakpoint
CREATE TABLE `kiosk_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registered_by_account_id` integer NOT NULL,
	`registered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`registered_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kiosk_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_session_id` text NOT NULL,
	`employee_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`device_session_id`) REFERENCES `device_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosk_interactions_token_hash_unique` ON `kiosk_interactions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `kiosk_interactions_device_idx` ON `kiosk_interactions` (`device_session_id`);--> statement-breakpoint
CREATE TABLE `location_settings` (
	`business_id` integer PRIMARY KEY NOT NULL,
	`work_week_start` integer DEFAULT 1 NOT NULL,
	`schedule_start_hour` integer DEFAULT 7 NOT NULL,
	`schedule_end_hour` integer DEFAULT 17 NOT NULL,
	`late_minutes` integer DEFAULT 1 NOT NULL,
	`early_clock_in_minutes` integer DEFAULT 5 NOT NULL,
	`require_early_clock_in_explanation` integer DEFAULT true NOT NULL,
	`require_late_clock_in_explanation` integer DEFAULT true NOT NULL,
	`require_clock_out_explanation` integer DEFAULT true NOT NULL,
	`require_unscheduled_explanation` integer DEFAULT true NOT NULL,
	`no_show_alerts` integer DEFAULT true NOT NULL,
	`no_show_minutes` integer DEFAULT 5 NOT NULL,
	`automatic_clock_out` integer DEFAULT true NOT NULL,
	`automatic_clock_out_minutes` integer DEFAULT 120 NOT NULL,
	`notify_schedule_changes` integer DEFAULT true NOT NULL,
	`employees_own_schedule_only` integer DEFAULT false NOT NULL,
	`require_availability_approval` integer DEFAULT true NOT NULL,
	`restrict_manager_departments` integer DEFAULT false NOT NULL,
	`enable_schedule_events` integer DEFAULT true NOT NULL,
	`meal_break_after_hours` integer DEFAULT 5 NOT NULL,
	`mandatory_meal_break` integer DEFAULT true NOT NULL,
	`enable_team_messaging` integer DEFAULT true NOT NULL,
	`hours_rounding_minutes` integer DEFAULT 15 NOT NULL,
	`kiosk_idle_seconds` integer DEFAULT 30 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "location_settings_week_check" CHECK("location_settings"."work_week_start" BETWEEN 0 AND 6),
	CONSTRAINT "location_settings_schedule_check" CHECK("location_settings"."schedule_start_hour" BETWEEN 0 AND 23 AND "location_settings"."schedule_end_hour" BETWEEN 1 AND 24 AND "location_settings"."schedule_start_hour" < "location_settings"."schedule_end_hour"),
	CONSTRAINT "location_settings_timing_check" CHECK("location_settings"."late_minutes" BETWEEN 1 AND 120 AND "location_settings"."early_clock_in_minutes" BETWEEN 0 AND 120 AND "location_settings"."no_show_minutes" BETWEEN 0 AND 120 AND "location_settings"."automatic_clock_out_minutes" BETWEEN 1 AND 1440 AND "location_settings"."meal_break_after_hours" BETWEEN 1 AND 24),
	CONSTRAINT "location_settings_rounding_check" CHECK("location_settings"."hours_rounding_minutes" IN (5, 10, 15) AND "location_settings"."kiosk_idle_seconds" BETWEEN 5 AND 600)
);
--> statement-breakpoint
CREATE TABLE `manager_approval_credentials` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_lookup` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_approval_credentials_pin_lookup_unique` ON `manager_approval_credentials` (`pin_lookup`);--> statement-breakpoint
CREATE TABLE `message_reads` (
	`message_id` integer NOT NULL,
	`conversation_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`read_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`message_id`, `employee_id`),
	FOREIGN KEY (`message_id`,`conversation_id`) REFERENCES `messages`(`id`,`conversation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`,`employee_id`) REFERENCES `conversation_members`(`conversation_id`,`employee_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`sender_employee_id` integer NOT NULL,
	`body` text NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`idempotency_key` text,
	FOREIGN KEY (`conversation_id`,`sender_employee_id`) REFERENCES `conversation_members`(`conversation_id`,`employee_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "messages_body_check" CHECK(length(trim("messages"."body")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_idempotency_key_unique` ON `messages` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_conversation_idx` ON `messages` (`id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_sent_idx` ON `messages` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` integer NOT NULL,
	`source_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`publication_id` integer,
	`pto_request_id` integer,
	`availability_request_id` integer,
	`event_target_id` text,
	`opened_at` text,
	`dismissed_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`publication_id`) REFERENCES `schedule_publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pto_request_id`) REFERENCES `pto_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`availability_request_id`) REFERENCES `availability_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_kind_check" CHECK("notifications"."kind" IN ('alert', 'request', 'schedule'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_employee_source_idx` ON `notifications` (`employee_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `notifications_employee_time_idx` ON `notifications` (`employee_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `onboarding_document_labels` (
	`employee_id` integer NOT NULL,
	`document_name` text NOT NULL,
	`file_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_id`, `document_name`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pto_assignments` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`policy_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`opening_balance_seconds` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `pto_policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pto_assignments_policy_idx` ON `pto_assignments` (`policy_id`);--> statement-breakpoint
CREATE TABLE `pto_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`status` text NOT NULL,
	`actor_account_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `pto_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pto_decisions_status_check" CHECK("pto_decisions"."status" IN ('approved', 'denied', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `pto_decisions_request_idx` ON `pto_decisions` (`request_id`);--> statement-breakpoint
CREATE TABLE `pto_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`method` text NOT NULL,
	`fixed_allowance_seconds` integer DEFAULT 0 NOT NULL,
	`earned_seconds` integer DEFAULT 0 NOT NULL,
	`per_worked_seconds` integer DEFAULT 3600 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pto_policies_method_check" CHECK(("pto_policies"."method" = 'fixed' AND "pto_policies"."fixed_allowance_seconds" > 0) OR ("pto_policies"."method" = 'rate' AND "pto_policies"."earned_seconds" > 0 AND "pto_policies"."per_worked_seconds" > 0))
);
--> statement-breakpoint
CREATE TABLE `pto_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`compensation` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`reason` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`decided_by_account_id` integer,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pto_requests_values_check" CHECK("pto_requests"."compensation" IN ('paid', 'unpaid') AND "pto_requests"."reason" IN ('sick_emergency', 'vacation') AND "pto_requests"."status" IN ('pending', 'approved', 'denied', 'cancelled') AND "pto_requests"."start_date" <= "pto_requests"."end_date")
);
--> statement-breakpoint
CREATE INDEX `pto_requests_employee_dates_idx` ON `pto_requests` (`employee_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `pto_requests_status_idx` ON `pto_requests` (`status`);--> statement-breakpoint
CREATE TABLE `schedule_draft_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` integer NOT NULL,
	`client_key` text NOT NULL,
	`operation` text NOT NULL,
	`shift_id` integer,
	`employee_id` integer,
	`role_id` integer,
	`role_name` text,
	`date` text,
	`start_time` text,
	`end_time` text,
	`station` text,
	`notes` text,
	FOREIGN KEY (`draft_id`) REFERENCES `schedule_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_draft_changes_operation_check" CHECK(("schedule_draft_changes"."operation" = 'delete' AND "schedule_draft_changes"."shift_id" IS NOT NULL) OR ("schedule_draft_changes"."operation" = 'upsert' AND "schedule_draft_changes"."employee_id" IS NOT NULL AND "schedule_draft_changes"."date" IS NOT NULL AND "schedule_draft_changes"."start_time" IS NOT NULL AND "schedule_draft_changes"."end_time" IS NOT NULL AND "schedule_draft_changes"."role_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_draft_changes_key_idx` ON `schedule_draft_changes` (`draft_id`,`client_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_draft_changes_shift_idx` ON `schedule_draft_changes` (`draft_id`,`shift_id`);--> statement-breakpoint
CREATE TABLE `schedule_draft_employees` (
	`draft_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`draft_id`, `employee_id`),
	FOREIGN KEY (`draft_id`) REFERENCES `schedule_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schedule_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_account_id` integer NOT NULL,
	`base_publication_version` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_drafts_version_check" CHECK("schedule_drafts"."base_publication_version" >= 0 AND "schedule_drafts"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_drafts_owner_account_id_unique` ON `schedule_drafts` (`owner_account_id`);--> statement-breakpoint
CREATE TABLE `schedule_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_account_id` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedule_events_date_idx` ON `schedule_events` (`date`);--> statement-breakpoint
CREATE TABLE `schedule_publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` integer NOT NULL,
	`published_by_account_id` integer NOT NULL,
	`published_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_publications_version_check" CHECK("schedule_publications"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_publications_version_unique` ON `schedule_publications` (`version`);--> statement-breakpoint
CREATE TABLE `time_card_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`actor_account_id` integer NOT NULL,
	`reason` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`,`employee_id`) REFERENCES `time_cards`(`id`,`employee_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_card_edits_revision_check" CHECK("time_card_edits"."revision" > 0 AND length(trim("time_card_edits"."reason")) > 0 AND json_valid("time_card_edits"."before") AND json_valid("time_card_edits"."after"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_card_edits_card_revision_idx` ON `time_card_edits` (`card_id`,`revision`);--> statement-breakpoint
CREATE TABLE `time_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`work_date` text NOT NULL,
	`role_id` integer,
	`role_name` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'punch' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_cards_source_check" CHECK("time_cards"."source" IN ('punch', 'manual') AND "time_cards"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_cards_id_employee_idx` ON `time_cards` (`id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `time_cards_employee_date_idx` ON `time_cards` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `wage_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`role_id` integer,
	`basis` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`effective_date` text NOT NULL,
	`recorded_by_account_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wage_rates_value_check" CHECK(typeof("wage_rates"."amount_cents") = 'integer' AND "wage_rates"."amount_cents" >= 0 AND "wage_rates"."basis" IN ('hourly', 'annual_salary'))
);
--> statement-breakpoint
CREATE INDEX `wage_rates_employee_effective_idx` ON `wage_rates` (`employee_id`,`effective_date`);--> statement-breakpoint
ALTER TABLE `clock_events` ADD `card_id` integer REFERENCES time_cards(id);--> statement-breakpoint
ALTER TABLE `clock_events` ADD `role_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `duration_seconds` integer;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `explanation` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `automatic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `source` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `device_id` text REFERENCES kiosk_devices(id);--> statement-breakpoint
ALTER TABLE `clock_events` ADD `recorded_by_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `clock_events` ADD `received_at` text;--> statement-breakpoint
ALTER TABLE `clock_events` ADD `idempotency_key` text;--> statement-breakpoint
CREATE INDEX `clock_events_card_idx` ON `clock_events` (`card_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `clock_events_idempotency_idx` ON `clock_events` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `employees` ADD `email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `payroll_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `payroll_classification` text DEFAULT 'W-2 Employee' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `terminated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `termination_date` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `termination_reason` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `termination_note` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `eligible_for_rehire` integer;--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_lookup` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `employees_pin_lookup_idx` ON `employees` (`pin_lookup`);--> statement-breakpoint
ALTER TABLE `roles` ADD `department_id` integer REFERENCES departments(id);--> statement-breakpoint
ALTER TABLE `roles` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `role_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `publication_id` integer REFERENCES schedule_publications(id);--> statement-breakpoint
ALTER TABLE `shifts` ADD `version` integer DEFAULT 1 NOT NULL;