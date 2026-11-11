import { json } from "../auth/http";
import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createWorkforceService } from "./service";
export async function handleWorkspace(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? ""); const fieldKey = String(env.AUTH_PRIVATE_FIELD_KEY ?? "");
    return await createWorkforceService(db, createAccessService(db, createAuthService(db, { secret })), { secret, fieldKey }).handle(request);
  } catch { return json({ error: "Shared workspace is temporarily unavailable. Try again shortly." }, 503); }
}
