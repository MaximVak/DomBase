import type { ClockType } from "../../kiosk/replay";
import type { ActionDetails } from "../../kiosk/break-rules";
import type { OfflineEntry } from "../../kiosk/offline-contract";
import { actionsStore, kioskStorage, progressStore } from "./kiosk-storage";

export type ClockInput = { eventType: ClockType; roleId?: number; explanation: string; details?: ActionDetails };
export type OfflineProgress = { anchor: string; state: ClockType; attemptedAt: number };
export type QueuedClock = OfflineEntry & { followUp?: { grant: string; progress: OfflineProgress } };
type Entry = QueuedClock & { needsHelp?: boolean };

export const queuedClocks = () => kioskStorage(actionsStore, "readonly", tx => {
  const request = tx.objectStore(actionsStore).getAll() as IDBRequest<Entry[]>;
  return () => request.result;
});
export const queueClock = (action: QueuedClock) => kioskStorage(actionsStore, "readwrite", tx => {
  tx.objectStore(actionsStore).add(action);
  return () => undefined;
});
export const holdClock = (action: QueuedClock) => kioskStorage(actionsStore, "readwrite", tx => {
  tx.objectStore(actionsStore).put({ ...action, needsHelp: true });
  return () => undefined;
});

export function removeClock(entry: QueuedClock, followedThrough = false) {
  return kioskStorage([actionsStore, progressStore], "readwrite", tx => {
    tx.objectStore(actionsStore).delete(entry.ticket);
    if (followedThrough && entry.followUp && !entry.offline) {
      const { grant, progress } = entry.followUp;
      const store = tx.objectStore(progressStore);
      const lookup = store.get(grant);
      lookup.onsuccess = () => {
        if (!lookup.result) store.put(progress, grant);
      };
    }
    return () => undefined;
  });
}

function getProgress(tx: IDBTransaction, grant: string, read: (progress: OfflineProgress | null) => void) {
  const saved = tx.objectStore(progressStore).get(grant);
  saved.onsuccess = () => {
    if (saved.result) { read(saved.result); return; }
    const pending = tx.objectStore(actionsStore).getAll() as IDBRequest<Entry[]>;
    pending.onsuccess = () => {
      const followUps = pending.result.filter(entry => !entry.needsHelp && entry.followUp?.grant === grant)
        .sort((a, b) => b.attemptedAt - a.attemptedAt);
      read(followUps[0]?.followUp?.progress ?? null);
    };
  };
}

export const readOfflineProgress = (grant: string) => kioskStorage([actionsStore, progressStore], "readonly", tx => {
  let progress: OfflineProgress | null = null;
  getProgress(tx, grant, value => { progress = value; });
  return () => progress;
});

export function queueOfflineClock(entry: QueuedClock, grant: string, previous: OfflineProgress | null) {
  return kioskStorage([actionsStore, progressStore], "readwrite", tx => {
    getProgress(tx, grant, latest => {
      if (latest?.anchor !== previous?.anchor || entry.attemptedAt < (latest?.attemptedAt ?? 0)) {
        tx.abort();
        return;
      }
      tx.objectStore(actionsStore).add(entry);
      tx.objectStore(progressStore).put({
        anchor: "offline." + entry.ticket, state: entry.eventType, attemptedAt: entry.attemptedAt,
      } satisfies OfflineProgress, grant);
    });
    return () => undefined;
  });
}
