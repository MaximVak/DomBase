import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// OWASP's memory-constrained scrypt profile; verified in the installed workerd.
const cost = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
export const dummyHash = `scrypt$16384$8$5$${"A".repeat(22)}$${"A".repeat(43)}`;
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenIsValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const rateKey = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, cost, (error, result) => error ? reject(error) : resolve(result));
  });
}

export function passwordIsValid(password: unknown): password is string {
  return typeof password === "string" && [...password].length >= 15
    && [...password].length <= 128 && Buffer.byteLength(password, "utf8") <= 512;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$16384$8$5$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const match = /^scrypt\$16384\$8\$5\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded);
  const actual = match ?? /^scrypt\$16384\$8\$5\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(dummyHash)!;
  const hash = await derive(password, Buffer.from(actual[1], "base64url"));
  const equal = timingSafeEqual(hash, Buffer.from(actual[2], "base64url"));
  return match !== null && equal;
}
