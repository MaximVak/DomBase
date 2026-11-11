import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
function key(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Private-field encryption is unavailable.");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32) throw new Error("Private-field encryption is unavailable.");
  return decoded;
}
export function encryptSsn(value: string, employeeId: number, secret: string, purpose = "ssn") {
  if (!value) return null;
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`dombase:${purpose}:v1:${employeeId}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}
export function decryptSsn(value: string | null, employeeId: number, secret: string, purpose = "ssn") {
  if (!value) return "";
  const parts = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/.exec(value);
  if (!parts) throw new Error("Private-field record is unavailable.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(parts[1], "base64url"));
  decipher.setAAD(Buffer.from(`dombase:${purpose}:v1:${employeeId}`)); decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
}
