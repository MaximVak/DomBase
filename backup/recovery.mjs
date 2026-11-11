import { Buffer } from "node:buffer";
import { hash, checkSecrets, checkObjects } from "./snapshot.mjs";
import { validateCompletion, unwrapDataKey, publicFingerprint, decryptPart, hostedLimits } from "./hosted-format.mjs";

// Decrypt/validate in memory. The caller controls a fresh isolated destination;
// this module has no live database/configuration/network client.
export async function recoverHostedBundle(receipt, readPart, privateKey) {
  const root = validateCompletion(receipt);
  if (publicFingerprint({ kty: privateKey.kty, n: privateKey.n, e: privateKey.e }) !== receipt.fingerprint) throw new Error("Recovery key fingerprint does not match this backup.");
  const key = await unwrapDataKey(receipt.wrappedKey, privateKey);
  const encoded = await readPart(receipt.manifest.key, receipt.manifest.size);
  const plaintext = await decryptPart(encoded, key, receipt.id, "manifest", receipt.manifest);
  if (plaintext.length > hostedLimits.manifestBytes) throw new Error("Manifest exceeds reviewed recovery limit.");
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (payload.version !== 1 || payload.source !== "hosted" || payload.createdAt !== receipt.createdAt || payload.localDay !== receipt.localDay || !Array.isArray(payload.snapshot?.tables) || !Array.isArray(payload.files) || payload.files.length !== receipt.objects) throw new Error("Backup manifest does not match completion receipt.");
  const objects = []; let total = 0; const keys = new Set();
  for (const [index, file] of payload.files.entries()) {
    if (index >= hostedLimits.objects || typeof file.key !== "string" || file.key.length > 1024 || keys.has(file.key) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > hostedLimits.objectBytes || (total += file.size) > hostedLimits.totalObjectBytes || file.part?.key !== root + `object-${String(index).padStart(4, "0")}.bin` || file.part.size !== file.size + 16) throw new Error("Invalid archived file inventory.");
    keys.add(file.key);
    const bytes = await decryptPart(await readPart(file.part.key, file.part.size), key, receipt.id, index, file.part);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error("Recovered file checksum failed.");
    objects.push({ key: file.key, size: file.size, sha256: file.sha256, bytes: Buffer.from(bytes).toString("base64"), httpMetadata: file.httpMetadata ?? {}, customMetadata: file.customMetadata ?? {} });
  }
  objects.sort((a, b) => a.key.localeCompare(b.key));
  const result = { version: 1, source: "hosted", createdAt: payload.createdAt, localDay: payload.localDay, snapshot: payload.snapshot, objects, secrets: checkSecrets(payload.secrets) };
  checkObjects(result.snapshot, objects); return result;
}
