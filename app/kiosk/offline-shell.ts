let preparing: Promise<boolean> | undefined;

export function prepareOfflineShell() {
  if (!("serviceWorker" in navigator) || !navigator.onLine) return Promise.resolve(false);
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      await navigator.serviceWorker.register("/kiosk-offline.js", { scope: "/kiosk" });
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active;
      if (!worker) return false;
      return await new Promise<boolean>(resolve => {
        const channel = new MessageChannel();
        const finish = (ready: boolean) => {
          window.clearTimeout(timer);
          channel.port1.close();
          resolve(ready);
        };
        const timer = window.setTimeout(() => finish(false), 16000);
        channel.port1.onmessage = event => finish(event.data === true);
        const assets = performance.getEntriesByType("resource").map(resource => resource.name);
        worker.postMessage({ type: "prepare-kiosk", assets }, [channel.port2]);
      });
    } catch { return false; }
  })();
  void preparing.then(ready => { if (!ready) preparing = undefined; });
  return preparing;
}
