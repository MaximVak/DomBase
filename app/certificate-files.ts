function openCertificateFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dombase-certificate-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeCertificateFile(id: string, file: File): Promise<void> {
  const database = await openCertificateFiles();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").put(file, id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function readCertificateFile(id: string): Promise<Blob | undefined> {
  const database = await openCertificateFiles();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readonly");
    const request = transaction.objectStore("files").get(id);
    transaction.oncomplete = () => { database.close(); resolve(request.result as Blob | undefined); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
