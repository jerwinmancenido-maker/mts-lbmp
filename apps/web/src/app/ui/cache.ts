"use client";

type CacheEnvelope<T> = {
  key: string;
  value: T;
  savedAt: string;
  source?: "cache" | "server" | "queue";
  userId?: string;
  branch?: string;
  module?: string;
};

const DB_NAME = "mts-lbmp-cache";
const STORE_NAME = "records";
const QUEUE_STORE_NAME = "offlineQueue";
const PHOTO_QUEUE_STORE_NAME = "photoQueue";
const DIAGNOSTIC_LOG_STORE_NAME = "diagnosticLogs";
const DB_VERSION = 4;

export type CacheMetadata = Pick<CacheEnvelope<unknown>, "savedAt" | "source" | "userId" | "branch" | "module">;

export type OfflineQueueRecord = {
  id: string;
  type: "payment" | "expense" | "photo" | "delivery" | "receivingDraft";
  method: "POST" | "PATCH";
  path: string;
  body?: unknown;
  createdAt: string;
  status: "Pending" | "Syncing" | "Synced" | "Failed";
  attempts: number;
  lastError?: string;
  userId?: string;
  branch?: string;
};

export type QueuedPhotoRecord = {
  localPhotoId: string;
  entityType: string;
  entityId?: string;
  photoType: string;
  compressedBlob: Blob;
  thumbnailBlob?: Blob;
  fileName: string;
  mimeType: string;
  byteSize: number;
  capturedAt: string;
  capturedByUserId?: string;
  branch?: string;
  gps?: string;
  status: "Pending" | "Syncing" | "Synced" | "Failed";
  attempts: number;
  lastError?: string;
  serverUrl?: string;
};

export type OfflineStorageSummary = {
  cachedRecords: number;
  cachedBytes: number;
  diagnosticLogs: {
    total: number;
    bytes: number;
    latestAt?: string;
  };
  offlineQueue: {
    total: number;
    pending: number;
    syncing: number;
    failed: number;
    synced: number;
  };
  photoQueue: {
    total: number;
    pending: number;
    syncing: number;
    failed: number;
    synced: number;
    bytes: number;
  };
  persistentStorage: "Granted" | "Denied" | "Unsupported";
  checkedAt: string;
};

export type DiagnosticLogRecord = {
  id: string;
  createdAt: string;
  level: "info" | "warning" | "error";
  source: "runtime" | "api" | "action" | "sync" | "printer" | "scanner" | "offline" | "device";
  message: string;
  details?: unknown;
  userId?: string;
  branch?: string;
  module?: string;
  url?: string;
  userAgent?: string;
  online?: boolean;
};

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        db.createObjectStore(QUEUE_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PHOTO_QUEUE_STORE_NAME)) {
        db.createObjectStore(PHOTO_QUEUE_STORE_NAME, { keyPath: "localPhotoId" });
      }
      if (!db.objectStoreNames.contains(DIAGNOSTIC_LOG_STORE_NAME)) {
        db.createObjectStore(DIAGNOSTIC_LOG_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open cache"));
  });
}

export async function readCachedValue<T>(key: string): Promise<T | null> {
  const cached = await readCachedRecord<T>(key);
  return cached?.value ?? null;
}

export async function readCachedRecord<T>(key: string): Promise<CacheEnvelope<T> | null> {
  if (!canUseIndexedDb()) return null;
  try {
    const db = await openCacheDb();
    return await new Promise<CacheEnvelope<T> | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as CacheEnvelope<T> | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Unable to read cache"));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeCachedValue<T>(key: string, value: T, metadata: Omit<CacheMetadata, "savedAt"> = {}): Promise<void> {
  if (!canUseIndexedDb()) return;
  try {
    const db = await openCacheDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, value, savedAt: new Date().toISOString(), ...metadata } satisfies CacheEnvelope<T>);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Unable to write cache"));
      };
    });
  } catch {
    // Cache failures should never block operations.
  }
}

export async function enqueueOfflineAction(input: Omit<OfflineQueueRecord, "id" | "createdAt" | "status" | "attempts">): Promise<OfflineQueueRecord> {
  const record: OfflineQueueRecord = {
    ...input,
    id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "Pending",
    attempts: 0
  };
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE_NAME, "readwrite");
    transaction.objectStore(QUEUE_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to queue action"));
    };
  });
  return record;
}

export async function listOfflineQueue(): Promise<OfflineQueueRecord[]> {
  if (!canUseIndexedDb()) return [];
  try {
    const db = await openCacheDb();
    return await new Promise<OfflineQueueRecord[]>((resolve, reject) => {
      const transaction = db.transaction(QUEUE_STORE_NAME, "readonly");
      const request = transaction.objectStore(QUEUE_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as OfflineQueueRecord[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      request.onerror = () => reject(request.error ?? new Error("Unable to read queue"));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function updateOfflineQueueRecord(record: OfflineQueueRecord): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE_NAME, "readwrite");
    transaction.objectStore(QUEUE_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to update queue"));
    };
  });
}

export async function enqueueQueuedPhoto(input: Omit<QueuedPhotoRecord, "localPhotoId" | "capturedAt" | "status" | "attempts">): Promise<QueuedPhotoRecord> {
  const record: QueuedPhotoRecord = {
    ...input,
    localPhotoId: `local-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: new Date().toISOString(),
    status: "Pending",
    attempts: 0
  };
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_QUEUE_STORE_NAME, "readwrite");
    transaction.objectStore(PHOTO_QUEUE_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to queue photo"));
    };
  });
  return record;
}

export async function listQueuedPhotos(): Promise<QueuedPhotoRecord[]> {
  if (!canUseIndexedDb()) return [];
  try {
    const db = await openCacheDb();
    return await new Promise<QueuedPhotoRecord[]>((resolve, reject) => {
      const transaction = db.transaction(PHOTO_QUEUE_STORE_NAME, "readonly");
      const request = transaction.objectStore(PHOTO_QUEUE_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as QueuedPhotoRecord[]).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)));
      request.onerror = () => reject(request.error ?? new Error("Unable to read photo queue"));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function updateQueuedPhoto(record: QueuedPhotoRecord): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_QUEUE_STORE_NAME, "readwrite");
    transaction.objectStore(PHOTO_QUEUE_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to update queued photo"));
    };
  });
}

export async function deleteQueuedPhoto(localPhotoId: string): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PHOTO_QUEUE_STORE_NAME, "readwrite");
    transaction.objectStore(PHOTO_QUEUE_STORE_NAME).delete(localPhotoId);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to delete queued photo"));
    };
  });
}

function countQueueStatuses<T extends { status: "Pending" | "Syncing" | "Synced" | "Failed" }>(records: T[]) {
  return {
    total: records.length,
    pending: records.filter((record) => record.status === "Pending").length,
    syncing: records.filter((record) => record.status === "Syncing").length,
    failed: records.filter((record) => record.status === "Failed").length,
    synced: records.filter((record) => record.status === "Synced").length
  };
}

function approximateCachedRecordBytes(record: CacheEnvelope<unknown>) {
  try {
    return new Blob([JSON.stringify(record)]).size;
  } catch {
    return 0;
  }
}

async function readAllCachedRecords(): Promise<CacheEnvelope<unknown>[]> {
  if (!canUseIndexedDb()) return [];
  try {
    const db = await openCacheDb();
    return await new Promise<CacheEnvelope<unknown>[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as CacheEnvelope<unknown>[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error("Unable to read cached records"));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return [];
  }
}

async function currentPersistentStorageState(): Promise<OfflineStorageSummary["persistentStorage"]> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return "Unsupported";
  try {
    return (await navigator.storage.persisted()) ? "Granted" : "Denied";
  } catch {
    return "Unsupported";
  }
}

export async function requestPersistentStorage(): Promise<OfflineStorageSummary["persistentStorage"]> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return "Unsupported";
  try {
    return (await navigator.storage.persist()) ? "Granted" : "Denied";
  } catch {
    return "Unsupported";
  }
}

export async function getOfflineStorageSummary(): Promise<OfflineStorageSummary> {
  const [cachedRecords, offlineQueue, photoQueue, diagnosticLogs, persistentStorage] = await Promise.all([
    readAllCachedRecords(),
    listOfflineQueue(),
    listQueuedPhotos(),
    listDiagnosticLogs(10000),
    currentPersistentStorageState()
  ]);
  return {
    cachedRecords: cachedRecords.length,
    cachedBytes: cachedRecords.reduce((sum, record) => sum + approximateCachedRecordBytes(record), 0),
    diagnosticLogs: {
      total: diagnosticLogs.length,
      bytes: diagnosticLogs.reduce((sum, record) => {
        try {
          return sum + new Blob([JSON.stringify(record)]).size;
        } catch {
          return sum;
        }
      }, 0),
      latestAt: diagnosticLogs[0]?.createdAt
    },
    offlineQueue: countQueueStatuses(offlineQueue),
    photoQueue: {
      ...countQueueStatuses(photoQueue),
      bytes: photoQueue.reduce((sum, record) => sum + (record.byteSize || record.compressedBlob?.size || 0), 0)
    },
    persistentStorage,
    checkedAt: new Date().toISOString()
  };
}

export async function clearCachedRecords(): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to clear cached screens"));
    };
  });
}

function normalizeDiagnosticDetails(details: unknown) {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack
    };
  }
  try {
    JSON.stringify(details);
    return details;
  } catch {
    return String(details);
  }
}

export async function appendDiagnosticLog(input: Omit<DiagnosticLogRecord, "id" | "createdAt" | "url" | "userAgent" | "online">): Promise<DiagnosticLogRecord | null> {
  if (!canUseIndexedDb()) return null;
  const record: DiagnosticLogRecord = {
    ...input,
    details: normalizeDiagnosticDetails(input.details),
    id: `diag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined
  };
  try {
    const db = await openCacheDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(DIAGNOSTIC_LOG_STORE_NAME, "readwrite");
      transaction.objectStore(DIAGNOSTIC_LOG_STORE_NAME).put(record);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Unable to save diagnostic log"));
      };
    });
    return record;
  } catch {
    return null;
  }
}

export async function listDiagnosticLogs(limit = 500): Promise<DiagnosticLogRecord[]> {
  if (!canUseIndexedDb()) return [];
  try {
    const db = await openCacheDb();
    return await new Promise<DiagnosticLogRecord[]>((resolve, reject) => {
      const transaction = db.transaction(DIAGNOSTIC_LOG_STORE_NAME, "readonly");
      const request = transaction.objectStore(DIAGNOSTIC_LOG_STORE_NAME).getAll();
      request.onsuccess = () =>
        resolve(
          ((request.result as DiagnosticLogRecord[]) ?? [])
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
        );
      request.onerror = () => reject(request.error ?? new Error("Unable to read diagnostic logs"));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function clearDiagnosticLogs(): Promise<void> {
  if (!canUseIndexedDb()) return;
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DIAGNOSTIC_LOG_STORE_NAME, "readwrite");
    transaction.objectStore(DIAGNOSTIC_LOG_STORE_NAME).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Unable to clear diagnostic logs"));
    };
  });
}

function replaceLocalPhotoReference(value: unknown, localPhotoUrl: string, serverUrl: string): unknown {
  if (value === localPhotoUrl) return serverUrl;
  if (Array.isArray(value)) return value.map((item) => replaceLocalPhotoReference(item, localPhotoUrl, serverUrl));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceLocalPhotoReference(entry, localPhotoUrl, serverUrl)])
    );
  }
  return value;
}

export async function replaceQueuedPhotoReferences(localPhotoId: string, serverUrl: string): Promise<void> {
  const localPhotoUrl = `local-photo://${localPhotoId}`;
  const queue = await listOfflineQueue();
  await Promise.all(
    queue
      .filter((record) => record.status === "Pending" || record.status === "Failed")
      .map((record) =>
        updateOfflineQueueRecord({
          ...record,
          body: replaceLocalPhotoReference(record.body, localPhotoUrl, serverUrl)
        })
      )
  );
}
