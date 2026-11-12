import { AuthError } from "../auth/http";
import type { Context } from "./context";

export function requireOtherEmployee(ctx: Context, employeeId: number) {
  if (ctx.account.accessLevel !== "owner" && ctx.account.employeeId === employeeId) {
    throw new AuthError(403, "An Owner must change your own wage or time card.");
  }
}
