import { headers } from "next/headers";
import { createAuthService } from "./service";
import { isLoopback, json, readSessionCookie } from "./http";
import { tokenIsValid } from "./crypto";
import { registeredDevice } from "../kiosk/device";

async function service() {
  const [{ env }, { getDb }] = await Promise.all([import("cloudflare:workers"), import("../db")]);
  return createAuthService(getDb(), { secret: String(env.AUTH_RATE_LIMIT_SECRET ?? "") });
}

export async function handleAuth(request: Request) {
  try { return await (await service()).handle(request); }
  catch { return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503); }
}

export async function authenticatedAccount() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const url = new URL(`https://${host || "invalid"}`);
  if (isLoopback(url.hostname)) url.protocol = "http:";
  const token = readSessionCookie(requestHeaders.get("cookie"), url);
  if (!tokenIsValid(token)) return null;
  try {
    const { getDb } = await import("../db");
    if (await registeredDevice(getDb(), requestHeaders.get("cookie"), url)) return null;
    return (await (await service()).getSession(token))?.account ?? null;
  }
  catch { return null; }
}

export async function dashboardAccount() {
  const account = await authenticatedAccount();
  return account && account.accessLevel !== "employee" ? account : null;
}
