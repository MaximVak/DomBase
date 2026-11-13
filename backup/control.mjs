const jsonOptions = { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } };
export async function readJson(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > 32 * 1024) throw new Error("Control object is too large.");
  return { value: await object.json(), etag: object.etag };
}
export async function putJson(bucket, key, value, etag) {
  return bucket.put(key, JSON.stringify(value), { ...jsonOptions, ...(etag === undefined ? {} : { onlyIf: etag === null ? { etagDoesNotMatch: "*" } : { etagMatches: etag } }) });
}
