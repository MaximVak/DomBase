export const actionsStore = "actions";
export const deviceStore = "device";
export const profilesStore = "profiles";
export const progressStore = "progress";

export async function kioskStorage<T>(stores: string | string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => () => T): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("dombase-kiosk-queue", 2);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(actionsStore)) db.createObjectStore(actionsStore, { keyPath: "ticket" });
      db.createObjectStore(deviceStore);
      db.createObjectStore(profilesStore, { keyPath: "employeeId" }).createIndex("lookup", "lookup", { unique: true });
      db.createObjectStore(progressStore);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("The tablet storage update is blocked."));
  });
  db.onversionchange = () => db.close();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const result = run(tx);
      tx.oncomplete = () => resolve(result());
      tx.onabort = () => reject(tx.error ?? new Error("Tablet storage was interrupted."));
      tx.onerror = () => reject(tx.error ?? new Error("Tablet storage is unavailable."));
    });
  } finally {
    db.close();
  }
}
