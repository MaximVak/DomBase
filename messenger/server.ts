import { createAccessService } from "../access/service";
import { json } from "../auth/http";
import { createAuthService } from "../auth/service";
import { createSelfService } from "../self/service";
import { createMessengerService } from "./service";
import { announcementEmailAvailable } from "./announcement-email";

export async function handleMessenger(request: Request) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb();
    const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? "");
    const auth = createAuthService(db, { secret });
    return await createMessengerService(db, auth, createAccessService(db, auth), createSelfService(db, auth, secret),
      { secret, bucket: env.FILES, announcementEmail: announcementEmailAvailable(env) }).handle(request);
  } catch {
    return json({ error: "Messenger is temporarily unavailable." }, 503);
  }
}
