CREATE TABLE `__new_pto_assignments` (
	`employee_id` integer NOT NULL,
	`category` text DEFAULT 'pto' NOT NULL,
	`policy_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`opening_balance_seconds` integer DEFAULT 0 NOT NULL,
	`legacy_balance_year` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_id`, `category`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`) REFERENCES `pto_policies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pto_assignments_category_check" CHECK("__new_pto_assignments"."category" IN ('pto', 'sick'))
);
--> statement-breakpoint
INSERT INTO `__new_pto_assignments`("employee_id", "category", "policy_id", "start_date", "opening_balance_seconds", "legacy_balance_year", "created_at", "updated_at")
SELECT "employee_id", 'pto', "policy_id", "start_date", "opening_balance_seconds", CAST(strftime('%Y', 'now', '-8 hours') AS INTEGER), "created_at", "updated_at"
FROM `pto_assignments`;--> statement-breakpoint
DROP TABLE `pto_assignments`;--> statement-breakpoint
ALTER TABLE `__new_pto_assignments` RENAME TO `pto_assignments`;--> statement-breakpoint
CREATE INDEX `pto_assignments_policy_idx` ON `pto_assignments` (`policy_id`);--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `category` text DEFAULT 'pto' NOT NULL;--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `fixed_frequency` text DEFAULT 'annual' NOT NULL;--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `max_balance_seconds` integer;--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `carryover_seconds` integer;--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `waiting_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pto_policies` ADD `tenure_bonuses` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TRIGGER pto_assignment_category_insert BEFORE INSERT ON pto_assignments
WHEN NOT EXISTS (SELECT 1 FROM pto_policies WHERE id = NEW.policy_id AND category = NEW.category)
BEGIN SELECT RAISE(ABORT, 'Leave policy category mismatch'); END;--> statement-breakpoint
CREATE TRIGGER pto_assignment_category_update BEFORE UPDATE OF policy_id, category ON pto_assignments
WHEN NOT EXISTS (SELECT 1 FROM pto_policies WHERE id = NEW.policy_id AND category = NEW.category)
BEGIN SELECT RAISE(ABORT, 'Leave policy category mismatch'); END;--> statement-breakpoint
CREATE TRIGGER pto_policy_category_immutable BEFORE UPDATE OF category ON pto_policies
WHEN NEW.category <> OLD.category
BEGIN SELECT RAISE(ABORT, 'Leave policy category is immutable'); END;
