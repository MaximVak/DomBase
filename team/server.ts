import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createTeamService } from "./service";
import { createInvitationService } from "./invitations";
import { json } from "../auth/http";
export async function handleTeam(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? "");
    if (new URL(request.url).pathname.startsWith("/api/invitations/")) return createInvitationService(db, secret).handle(request);
    return createTeamService(db, createAccessService(db, createAuthService(db, { secret })), { secret, fieldKey: String(env.AUTH_PRIVATE_FIELD_KEY ?? "") }).handle(request);
  } catch { return json({ error: "Team is temporarily unavailable." }, 503); }
}
