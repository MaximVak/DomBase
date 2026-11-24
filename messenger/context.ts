import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { AuthError } from "../auth/http";

export type MessengerActor = {
  account: { id: number; employeeId: number }; activeActor: () => SQL;
  employeeScope: (column: SQLWrapper) => SQL; roleScope: (column: SQLWrapper) => SQL;
  departmentScope: (column: SQLWrapper) => SQL; scheduleScope: "department" | "own" | "none";
};

export const messagingEnabled = sql`COALESCE((SELECT enable_team_messaging FROM location_settings WHERE business_id=1),1)=1`;
export function conversationAccess(ctx: MessengerActor, conversation: SQLWrapper) {
  return sql`EXISTS (SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE c.id=${conversation} AND c.archived_at IS NULL AND cm.employee_id=${ctx.account.employeeId} AND cm.left_at IS NULL)
    AND ${ctx.activeActor()} AND ${messagingEnabled}`;
}

export function uploadToken(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AuthError(400, "Invalid attachment identifier.");
  return value;
}
