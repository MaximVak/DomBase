import { json } from "../auth/http";
import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createKioskAdmin } from "./admin";
import { createKioskService } from "./service";

export async function handleKiosk(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? "");
    if (new URL(request.url).pathname.startsWith("/api/kiosk-admin/")) {
      const auth = createAuthService(db, { secret });
      return await createKioskAdmin(db, createAccessService(db, auth), secret).handle(request);
    }
    return await createKioskService(db, { secret }).handle(request);
  } catch { return json({ error: "The time clock is temporarily unavailable. Try again shortly." }, 503); }
}
