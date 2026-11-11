import { json } from "../auth/http";
import { createAuthService } from "../auth/service";
import { createSelfService } from "./service";
export async function handleSelf(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? "");
    return await createSelfService(db, createAuthService(db, { secret }), secret).handle(request);
  } catch { return json({ error: "Your profile is temporarily unavailable. Try again shortly." }, 503); }
}
