import { createAccessService } from "./service";
import { createAuthService } from "../auth/service";
import { json } from "../auth/http";

export async function handleAccess(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb();
    return await createAccessService(db, createAuthService(db, { secret: String(env.AUTH_RATE_LIMIT_SECRET ?? "") })).handle(request);
  } catch {
    return json({ error: "This request is temporarily unavailable. Try again shortly." }, 503);
  }
}
