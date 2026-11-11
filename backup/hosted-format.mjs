import { Buffer } from "node:buffer";
import { hash, canonical } from "./snapshot.mjs";

export const hostedFormat = "dombase-hosted-backup-v1";
export const hostedLimits = { manifestBytes: 16 * 1024 * 1024, objectBytes: 10 * 1024 * 1024, totalObjectBytes: 64 * 1024 * 1024, objects: 1000 };
export function backupCalendar(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = type => parts.find(part => part.type === type).value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}
export function publicFingerprint(jwk) {
  if (jwk?.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string" || jwk.d) throw new Error("Invalid public backup key.");
  return hash(canonical({ kty: jwk.kty, n: jwk.n, e: jwk.e }));
}
export function partContext(backupId, part) {
  if (!/^[0-9a-f-]{36}$/.test(backupId) || !(part === "manifest" || Number.isSafeInteger(part) && part >= 0 && part < hostedLimits.objects)) throw new Error("Invalid backup part context.");
  return new TextEncoder().encode(`${hostedFormat}:${backupId}:${part}`);
}
export async function encryptPart(bytes, key, backupId, part) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: partContext(backupId, part) }, aes, bytes));
  return { bytes: encrypted, iv: Buffer.from(iv).toString("base64"), sha256: hash(encrypted), size: encrypted.length };
}
export async function decryptPart(bytes, key, backupId, part, info) {
  if (bytes.length !== info.size || hash(bytes) !== info.sha256 || !/^[A-Za-z0-9+/]{16}$/.test(info.iv)) throw new Error("Encrypted backup part is damaged.");
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(info.iv, "base64"), additionalData: partContext(backupId, part) }, aes, bytes)); }
  catch { throw new Error("Backup decryption failed."); }
}
export async function wrapDataKey(key, publicKey) {
  publicFingerprint(publicKey);
  const rsa = await crypto.subtle.importKey("jwk", publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  return Buffer.from(await crypto.subtle.encrypt("RSA-OAEP", rsa, key)).toString("base64");
}
export async function unwrapDataKey(envelope, privateKey) {
  if (typeof envelope !== "string" || envelope.length > 1024) throw new Error("Invalid wrapped backup key.");
  try {
    const rsa = await crypto.subtle.importKey("jwk", privateKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
    const key = new Uint8Array(await crypto.subtle.decrypt("RSA-OAEP", rsa, Buffer.from(envelope, "base64")));
    if (key.length !== 32) throw new Error("Invalid data key."); return key;
  } catch { throw new Error("The separate private recovery key cannot decrypt this backup."); }
}
export function validateCompletion(receipt) {
  if (receipt?.format !== hostedFormat || !/^[0-9a-f-]{36}$/.test(receipt.id) || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.localDay) || !Number.isFinite(Date.parse(receipt.createdAt)) || !/^[0-9a-f]{64}$/.test(receipt.fingerprint)) throw new Error("Invalid backup completion receipt.");
  const root = `runs/${receipt.localDay}/${receipt.id}/`;
  if (receipt.manifest?.key !== root + "manifest.bin" || !Number.isSafeInteger(receipt.manifest.size) || receipt.manifest.size < 16 || receipt.manifest.size > hostedLimits.manifestBytes + 16 || !Number.isSafeInteger(receipt.objects) || receipt.objects < 0 || receipt.objects > hostedLimits.objects) throw new Error("Invalid backup manifest descriptor.");
  return root;
}
