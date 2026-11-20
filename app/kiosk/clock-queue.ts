import type { ClockType } from "../../kiosk/replay";
import type { ActionDetails } from "../../kiosk/break-rules";

export type ClockInput = { eventType: ClockType; roleId?: number; explanation: string; details?: ActionDetails };
export type QueuedClock = ClockInput & { ticket: string; attemptedAt: number };
type Entry = QueuedClock & { needsHelp?: boolean };
const storeName = "actions";

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("dombase-kiosk-queue", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(storeName, { keyPath: "ticket" });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Clock queue transaction was cancelled."));
      tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally { db.close(); }
}

export const queuedClocks = () => transaction<Entry[]>("readonly", store => store.getAll());
export const queueClock = (action: QueuedClock) => transaction("readwrite", store => store.add(action));
export const removeClock = (ticket: string) => transaction("readwrite", store => store.delete(ticket));
export const holdClock = (action: QueuedClock) => transaction("readwrite", store => store.put({ ...action, needsHelp: true }));
