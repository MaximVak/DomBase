import { createHash, createHmac } from "node:crypto";

export const offsitePrefix = "dombase/staging/";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// One atomic Worker secret. Neither arbitrary endpoints nor master account keys
// belong here. A destination change gets its own replication checkpoints.
export function b2Config(raw) {
  if (raw === undefined || raw === "") return null;
  try {
    const config = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Object.keys(config).sort().join() !== "applicationKey,bucket,keyId,region"
      || !/^[a-z]{2}-[a-z]+-\d{3}$/.test(config.region)
      || !/^[A-Za-z0-9][A-Za-z0-9-]{4,48}[A-Za-z0-9]$/.test(config.bucket)
      || !/^[A-Za-z0-9]{10,100}$/.test(config.keyId)
      || !/^[A-Za-z0-9+/=]{20,200}$/.test(config.applicationKey)) throw new Error();
    return { ...config, identity: sha256(`${config.region}/${config.bucket}`).slice(0, 24) };
  } catch { throw new Error("Invalid off-site backup configuration."); }
}

// AWS Signature V4, with an explicit payload digest (including GET/HEAD).
export function signedS3Headers({ method, host, path, query = "", bytes = new Uint8Array(), region, keyId, applicationKey, now = Date.now(), extra = {} }) {
  const stamp = new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, ""), day = stamp.slice(0, 8);
  const headers = { host, "x-amz-content-sha256": sha256(bytes), "x-amz-date": stamp, ...extra };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, query, names.map(name => `${name}:${String(headers[name]).trim()}\n`).join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${applicationKey}`, day), region), "s3"), "aws4_request");
  const signature = hmac(key, `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).toString("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Off-site response exceeds limit."); }
  const reader = response.body?.getReader(); const chunks = []; let length = 0;
  if (reader) try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new Error("Off-site response exceeds limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function createB2Client(config, { fetcher = fetch, clock = Date.now } = {}) {
  const host = `s3.${config.region}.backblazeb2.com`;
  async function request(method, key, bytes, query = "", limit = 17 * 1024 * 1024) {
    if (!["HEAD", "GET", "PUT"].includes(method) || key && (!key.startsWith(offsitePrefix) || !/^[a-zA-Z0-9/._-]+$/.test(key) || key.includes(".."))
      || !["", "acl=", "lifecycle="].includes(query)) throw new Error("Off-site operation is not permitted.");
    const path = `/${encode(config.bucket)}/${key.split("/").map(encode).join("/")}`;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = signedS3Headers({ method, host, path, query, bytes, ...config, now: clock(), extra: method === "PUT" ? { "content-type": "application/octet-stream", "x-amz-meta-sha256": sha256(bytes) } : {} });
      const response = await fetcher(`https://${host}${path}${query ? `?${query}` : ""}`, { method, headers, body: method === "PUT" ? bytes : undefined, redirect: "error", signal: controller.signal });
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw new Error("Off-site storage request failed."); }
      if (method === "HEAD") return { size: Number(response.headers.get("content-length")), sha256: response.headers.get("x-amz-meta-sha256") };
      return await boundedBody(response, limit);
    } catch { throw new Error("Off-site storage request failed."); }
    finally { clearTimeout(timeout); }
  }
  return {
    async get(key, limit) { return request("GET", key, undefined, "", limit); },
    async bucketInfo(query) { const bytes = await request("GET", "", undefined, `${query}=`, 65536); if (!bytes) throw new Error("Off-site bucket configuration is unavailable."); return new TextDecoder().decode(bytes); },
    async copy(key, bytes) {
      const prior = await request("HEAD", key);
      if (prior && (prior.size !== bytes.length || prior.sha256 !== sha256(bytes))) throw new Error("Off-site object differs from the archive.");
      if (!prior) await request("PUT", key, bytes);
      // Read actual provider bytes: an acknowledged PUT/HEAD is not integrity
      // proof. Resuming after a timeout reuses the same key and verifies it.
      const saved = await request("GET", key, undefined, "", bytes.length);
      if (!saved || saved.length !== bytes.length || sha256(saved) !== sha256(bytes)) throw new Error("Off-site verification failed.");
    },
  };
}
