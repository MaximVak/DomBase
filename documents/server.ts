import { createAuthService } from "../auth/service";
import { createAccessService } from "../access/service";
import { createDocumentService } from "./service";
import { json } from "../auth/http";
import type { DocumentBucket } from "./types";
async function handleRequest(request: Request, selfPhoto: boolean) {
  try {
    const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
    const db = getDb(); const secret = String(env.AUTH_RATE_LIMIT_SECRET ?? "");
    return await createDocumentService(db, createAccessService(db, createAuthService(db, { secret })), { bucket: env.FILES as DocumentBucket | undefined, secret, ...(selfPhoto ? { selfAuth: createAuthService(db, { secret }) } : {}) }).handle(request);
  } catch { return json({ error: "Private file storage is temporarily unavailable." }, 503); }
}

export const handleDocuments = (request: Request) => handleRequest(request, false);
export const handleSelfPhoto = (request: Request) => handleRequest(request, true);
