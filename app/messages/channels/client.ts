import { messengerApi } from "../client";

export const channelAction = <T>(body: Record<string, unknown>) => messengerApi<T>("channels/actions", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
