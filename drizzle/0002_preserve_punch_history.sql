-- Preserve known scaffold relationships without inventing accounts or permissions.
INSERT INTO employee_roles (employee_id, role_id, active, created_at, updated_at)
SELECT id, role_id, active, created_at, updated_at FROM employees WHERE role_id IS NOT NULL;
--> statement-breakpoint
UPDATE shifts SET role_name = coalesce((SELECT name FROM roles WHERE roles.id = shifts.role_id), '')
WHERE role_name = '';
--> statement-breakpoint
UPDATE clock_events SET
  role_name = coalesce(
    (SELECT role_name FROM shifts WHERE shifts.id = clock_events.shift_id),
    (SELECT roles.name FROM employees JOIN roles ON roles.id = employees.role_id WHERE employees.id = clock_events.employee_id),
    ''
  ),
  received_at = created_at;
--> statement-breakpoint
-- ALTER-only expansion avoids rebuilding referenced tables or disabling D1 FKs.
-- Validate new punches, including links to a card/shift owned by the same person.
CREATE TRIGGER clock_events_validate_insert BEFORE INSERT ON clock_events BEGIN
  SELECT CASE WHEN NEW.event_type NOT IN ('in', 'out', 'break', 'break_end')
    OR NEW.source NOT IN ('legacy', 'kiosk', 'manager', 'system', 'offline')
    OR NEW.automatic NOT IN (0, 1)
    OR (NEW.duration_seconds IS NOT NULL AND (typeof(NEW.duration_seconds) != 'integer' OR NEW.duration_seconds < 0))
    THEN RAISE(ABORT, 'Invalid clock event') END;
  SELECT CASE WHEN NEW.card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM time_cards WHERE id = NEW.card_id AND employee_id = NEW.employee_id
  ) THEN RAISE(ABORT, 'Clock event card belongs to a different employee') END;
  SELECT CASE WHEN NEW.shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shifts WHERE id = NEW.shift_id AND employee_id = NEW.employee_id
  ) THEN RAISE(ABORT, 'Clock event shift belongs to a different employee') END;
  SELECT CASE WHEN NEW.source IN ('kiosk', 'offline') AND (NEW.device_id IS NULL OR NEW.received_at IS NULL)
    THEN RAISE(ABORT, 'Device punches require device and receipt attribution') END;
END;
--> statement-breakpoint
-- Corrections append revisions. Original punches and their audit records survive.
CREATE TRIGGER clock_events_no_update BEFORE UPDATE ON clock_events BEGIN
  SELECT RAISE(ABORT, 'Raw clock events are immutable; append a time-card revision');
END;
--> statement-breakpoint
CREATE TRIGGER clock_events_no_delete BEFORE DELETE ON clock_events BEGIN
  SELECT RAISE(ABORT, 'Raw clock events are immutable; append a time-card revision');
END;
--> statement-breakpoint
CREATE TRIGGER time_card_edits_no_update BEFORE UPDATE ON time_card_edits BEGIN
  SELECT RAISE(ABORT, 'Time-card history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER time_card_edits_no_delete BEFORE DELETE ON time_card_edits BEGIN
  SELECT RAISE(ABORT, 'Time-card history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER hours_adjustments_no_update BEFORE UPDATE ON hours_adjustments BEGIN
  SELECT RAISE(ABORT, 'Hours adjustments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER hours_adjustments_no_delete BEFORE DELETE ON hours_adjustments BEGIN
  SELECT RAISE(ABORT, 'Hours adjustments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'Audit history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'Audit history is append-only');
END;
