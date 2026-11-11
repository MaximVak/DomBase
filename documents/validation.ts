import { AuthError } from "../auth/http";
import { maxFileBytes } from "./types";
export function sameOrigin(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"))) throw new AuthError(403, "Request origin is not allowed.");
}
export async function fileBytes(request: Request) {
  sameOrigin(request);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxFileBytes)) throw new AuthError(413, "Files must be 10 MB or smaller.");
  const reader = request.body?.getReader(); if (!reader) throw new AuthError(400, "Choose a file.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxFileBytes) { await reader.cancel(); throw new AuthError(413, "Files must be 10 MB or smaller."); } chunks.push(value); }
  if (!size) throw new AuthError(400, "Empty files cannot be uploaded.");
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export function validateFileName(name: string, type: string) {
  if (!name || name.length > 180 || ([...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[/\\]/.test(name)) || /[. ]$/.test(name)) throw new AuthError(400, "Use a file name without path or control characters.");
  const endings: Record<string, RegExp> = { "application/pdf": /\.pdf$/i, "image/png": /\.png$/i, "image/jpeg": /\.jpe?g$/i, "image/gif": /\.gif$/i };
  if (!endings[type]?.test(name)) throw new AuthError(415, "Choose a PDF, PNG, JPG/JPEG, or GIF file.");
}
export function validateSignature(bytes: Uint8Array, type: string) {
  const prefix = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!(type === "application/pdf" && ascii.startsWith("%PDF-") || type === "image/png" && prefix(137, 80, 78, 71, 13, 10, 26, 10) || type === "image/jpeg" && prefix(255, 216, 255) || type === "image/gif" && /^GIF8[79]a/.test(ascii))) throw new AuthError(415, "The file contents do not match its type.");
}
export function downloadHeaders(name: string, type: string, size: number) {
  const ascii = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return { "Content-Type": type, "Content-Length": String(size), "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`, "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY" };
}
