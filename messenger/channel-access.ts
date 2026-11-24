import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { AuthenticatedAccount } from "../auth/types";
import { messagingEnabled } from "./context";
import type { Channel } from "./channel-model";

export type ChannelActor = { account: AuthenticatedAccount; activeActor: () => ReturnType<typeof sql>; canPublish: boolean };

export const channelsEnabled = sql`${messagingEnabled}
  AND COALESCE((SELECT enable_company_channels FROM location_settings WHERE business_id=1),1)=1`;

export function channelAudience(channel: SQLWrapper) {
  return sql`a.login_enabled=1 AND a.disabled_at IS NULL
    AND (a.employee_id IS NULL AND a.access_level<>'employee' OR EXISTS (
      SELECT 1 FROM employees e WHERE e.id=a.employee_id AND e.active=1 AND e.terminated=0))
    AND ((${channel}='company' AND a.access_level='employee') OR
      (a.access_level IN ('owner','general_manager','manager') AND (a.access_level='owner' OR COALESCE((
        SELECT allowed FROM account_permissions WHERE account_id=a.id AND permission='messages.read'),1)=1)))`;
}

export function channelGuard(actor: ChannelActor, channel: SQLWrapper) {
  return sql`${channelsEnabled} AND ${actor.activeActor()} AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=${actor.account.id} AND ${channelAudience(channel)})`;
}

export function channelsFor(actor: ChannelActor): Channel[] {
  return actor.account.accessLevel === "employee" ? ["company"] : ["company", "managers"];
}
