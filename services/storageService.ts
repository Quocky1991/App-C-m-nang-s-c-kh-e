
import { HealthHandbook, HealthAsset } from "../types";

const DB_NAME = "HealthCareStudioDB_Final"; 
const STORE_HANDBOOKS = "handbooks";
const STORE_ASSETS = "assets";
const DB_VERSION = 5; // Tăng version để đảm bảo trigger upgrade đúng cách

let dbPromise: Promise<IDBDatabase> | null = null;

export const requestPersistence = async () => {
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist();
  }
};

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_HANDBOOKS)) {
        db.createObjectStore(STORE_HANDBOOKS, { keyPath: "id" });
      }
      
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
};

export const getAllHandbooks = async (): Promise<HealthHandbook[]> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_HANDBOOKS, "readonly");
    const store = transaction.objectStore(STORE_HANDBOOKS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
  });
};

export const saveHandbookToDB = async (handbook: HealthHandbook): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_HANDBOOKS, "readwrite");
    const store = transaction.objectStore(STORE_HANDBOOKS);
    store.put(handbook);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteHandbookFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_HANDBOOKS, "readwrite");
    const store = transaction.objectStore(STORE_HANDBOOKS);
    store.delete(id);
    transaction.oncomplete = () => resolve();
  });
};

export const getAllAssets = async (): Promise<HealthAsset[]> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_ASSETS, "readonly");
    const store = transaction.objectStore(STORE_ASSETS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
  });
};

export const saveAssetToDB = async (asset: HealthAsset): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_ASSETS, "readwrite");
    const store = transaction.objectStore(STORE_ASSETS);
    store.put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteAssetFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_ASSETS, "readwrite");
    const store = transaction.objectStore(STORE_ASSETS);
    store.delete(id);
    transaction.oncomplete = () => resolve();
  });
};
