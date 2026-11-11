export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function cookieName(url: URL) {
  return url.protocol === "https:" ? "__Host-dombase-session" : "dombase-session";
}

export function sessionCookie(url: URL, token: string, maxAge: number) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function readSessionCookie(cookie: string | null, url: URL) {
  const name = cookieName(url);
  const parts = (cookie ?? "").split(";").map(part => part.trim());
  const found = parts.filter(part => part.startsWith(`${name}=`));
  return found.length === 1 ? found[0].slice(name.length + 1) : "";
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", ...extra,
  } });
}

export async function readAuthBody(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
  if (request.headers.get("origin") !== url.origin) throw new AuthError(403, "Request origin is not allowed.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new AuthError(403, "Request origin is not allowed.");
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new AuthError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, "Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AuthError(413, "Request is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AuthError(400, "Invalid request."); }
}
