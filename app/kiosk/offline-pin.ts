import { offlineAccessMs, offlineActionPayload } from "../../kiosk/offline-contract";
import type { OfflineAuthorization } from "../../kiosk/offline-contract";
import type { ClockPerson } from "./clock-panel";
import { queueOfflineClock, readOfflineProgress } from "./clock-queue";
import type { ClockInput, OfflineProgress, QueuedClock } from "./clock-queue";
import { deviceStore, kioskStorage, profilesStore, progressStore } from "./kiosk-storage";

type OfflineDevice = { tag: string; name: string; key: CryptoKey; salt: Uint8Array<ArrayBuffer> };
type Profile = { grantId: string; employeeId: number; lookup: string; expiresAt: number; iv: Uint8Array<ArrayBuffer>; sealed: ArrayBuffer };
type OfflinePerson = Pick<ClockPerson, "employee" | "roles" | "state">;
type OfflineSession = { clockOffset: number; authorization: OfflineAuthorization; person: OfflinePerson; progress: OfflineProgress | null };
export type PreparedPin = { deviceTag: string; clockOffset: number; lookup: string; key: CryptoKey; authorization: OfflineAuthorization; person: OfflinePerson };
const deviceMarker = "dombase-kiosk-offline";
const encoder = new TextEncoder();
const toHex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");

async function storedDevice() {
  return kioskStorage(deviceStore, "readonly", tx => {
    const request = tx.objectStore(deviceStore).get("registered") as IDBRequest<OfflineDevice | undefined>;
    return () => request.result;
  });
}
function marker(tag: string) {
  const seconds = tag ? offlineAccessMs / 1000 : 0;
  document.cookie = `${deviceMarker}=${tag}; Path=/kiosk; SameSite=Strict; Max-Age=${seconds}${location.protocol === "https:" ? "; Secure" : ""}`;
}
async function localDevice() {
  const device = await storedDevice();
  const marked = document.cookie.split(";").some(item => item.trim() === `${deviceMarker}=${device?.tag}`);
  return marked ? device : undefined;
}

export async function prepareOfflineDevice(tag: string, name: string) {
  const old = await storedDevice();
  if (old?.tag !== tag || old.name !== name) {
    const key = old?.tag === tag ? old.key : await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const salt = old?.tag === tag ? old.salt : crypto.getRandomValues(new Uint8Array(16));
    await kioskStorage([deviceStore, profilesStore, progressStore], "readwrite", tx => {
      if (old?.tag !== tag) { tx.objectStore(profilesStore).clear(); tx.objectStore(progressStore).clear(); }
      tx.objectStore(deviceStore).put({ tag, name, key, salt } satisfies OfflineDevice, "registered");
      return () => undefined;
    });
  }
  marker(tag);
}

export async function clearOfflineDevice() {
  marker("");
  await kioskStorage([deviceStore, profilesStore, progressStore], "readwrite", tx => {
    tx.objectStore(deviceStore).delete("registered");
    tx.objectStore(profilesStore).clear();
    tx.objectStore(progressStore).clear();
    return () => undefined;
  });
}

export async function offlineDeviceName() {
  const device = await localDevice();
  if (!device) return;
  return kioskStorage(profilesStore, "readonly", tx => {
    const request = tx.objectStore(profilesStore).getAll() as IDBRequest<Profile[]>;
    return () => request.result.some(profile => profile.expiresAt > Date.now()) ? device.name : undefined;
  });
}

async function pinKeys(device: OfflineDevice, pin: string) {
  const peppered = await crypto.subtle.sign("HMAC", device.key, encoder.encode(pin));
  const input = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: device.salt, hash: "SHA-256", iterations: 600000 }, input, 512);
  const lookup = toHex(new Uint8Array(derived, 0, 32));
  const key = await crypto.subtle.importKey("raw", derived.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { lookup, key };
}

export async function storePreparedPin(prepared: PreparedPin) {
  const device = await localDevice();
  if (!device || device.tag !== prepared.deviceTag) return;
  const { lookup, key, authorization, person, clockOffset } = prepared;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(device.tag) }, key,
    encoder.encode(JSON.stringify({ authorization, person, clockOffset })));
  await kioskStorage([deviceStore, profilesStore, progressStore], "readwrite", tx => {
    const current = tx.objectStore(deviceStore).get("registered");
    current.onsuccess = () => {
      if (current.result?.tag !== device.tag) return;
      const profiles = tx.objectStore(profilesStore);
      const previous = profiles.get(person.employee.id);
      previous.onsuccess = () => {
        if (previous.result?.grantId && previous.result.grantId !== authorization.id) tx.objectStore(progressStore).delete(previous.result.grantId);
      };
      const duplicate = profiles.index("lookup").get(lookup);
      duplicate.onsuccess = () => {
        if (duplicate.result && duplicate.result.employeeId !== person.employee.id) {
          profiles.delete(duplicate.result.employeeId);
          tx.objectStore(progressStore).delete(duplicate.result.grantId);
        }
        profiles.put({ grantId: authorization.id, employeeId: person.employee.id, lookup, expiresAt: authorization.expiresAt, iv, sealed } satisfies Profile);
      };
    };
    return () => undefined;
  });
}

export async function prepareEmployeePin(pin: string, data: ClockPerson & { offline: OfflineAuthorization }) {
  const device = await localDevice();
  if (!device) return;
  const clockOffset = data.offline.issuedAt - Date.now();
  const prepared = { deviceTag: device.tag, clockOffset, ...await pinKeys(device, pin), authorization: data.offline,
    person: { employee: data.employee, roles: data.roles, state: data.state } };
  await storePreparedPin(prepared);
  return prepared;
}

// Reserve a tablet-wide attempt before the expensive PIN check. Failures survive a reboot.
async function offlineAttempt(release?: number) {
  return kioskStorage(deviceStore, "readwrite", tx => {
    const store = tx.objectStore(deviceStore);
    const request = store.get("attempts");
    let retry = 0;
    let until = 0;
    request.onsuccess = () => {
      const now = Date.now();
      const limit = 20;
      const existing = request.result as { until: number; attempts: number } | undefined;
      const budget = existing && now < existing.until ? existing : { until: now + 15 * 60000, attempts: 0 };
      until = budget.until;
      if (release === budget.until) budget.attempts = Math.max(0, budget.attempts - 1);
      else if (release === undefined && budget.attempts < limit) budget.attempts++;
      else if (release === undefined) retry = Math.ceil((budget.until - now) / 1000);
      store.put(budget, "attempts");
    };
    return () => ({ retry, until });
  });
}

export async function signInOffline(pin: string): Promise<{ session?: OfflineSession; retry?: number }> {
  const device = await localDevice();
  if (!device || !/^\d{4,8}$/.test(pin)) return {};
  const attempt = await offlineAttempt();
  if (attempt.retry) return { retry: attempt.retry };
  const { lookup, key } = await pinKeys(device, pin);
  const record = await kioskStorage(profilesStore, "readonly", tx => {
    const request = tx.objectStore(profilesStore).index("lookup").get(lookup) as IDBRequest<Profile | undefined>;
    return () => request.result;
  });
  if (!record || record.expiresAt <= Date.now()) return {};
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: encoder.encode(device.tag) }, key, record.sealed);
  const { authorization, person, clockOffset } = JSON.parse(new TextDecoder().decode(clear)) as Omit<OfflineSession, "progress">;
  if (!Number.isFinite(clockOffset) || authorization.expiresAt <= Date.now() + clockOffset) return {};
  await offlineAttempt(attempt.until);
  return { session: { authorization, person, clockOffset, progress: await readOfflineProgress(authorization.id) } };
}

export async function recordOfflineClock(session: OfflineSession, input: ClockInput) {
  const { authorization, progress } = session;
  const attemptedAt = Date.now() + session.clockOffset;
  if (attemptedAt >= authorization.expiresAt) throw new Error("Offline access has expired.");
  const ticket = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const action = { ...input, ticket, attemptedAt };
  const previous = progress?.anchor ?? null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(authorization.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const proof = toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(offlineActionPayload(action, previous)))));
  const entry = { ...action, offline: { token: authorization.token, previous, proof } } satisfies QueuedClock;
  await queueOfflineClock(entry, authorization.id, progress);
}

export type { OfflineSession };
