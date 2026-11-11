import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createCommunityService } from "./service";
import { json } from "../auth/http";
export async function handleCommunity(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(), secret = String(env.AUTH_RATE_LIMIT_SECRET ?? ""), auth = createAuthService(db, { secret });
    return await createCommunityService(db, auth, createAccessService(db, auth), secret).handle(request);
  } catch { return json({ error: "Team recognition is temporarily unavailable." }, 503); }
}
