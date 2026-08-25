import {
  isTldrawRecoveryDraft,
  type TldrawRecoveryDraft,
} from "./tldrawRecoveryModel";

const DEFAULT_DATABASE_NAME = "ea-tldraw-recovery";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";
const DOCUMENT_KEY = "owner-canvas";

type RecoveryStoreOptions = {
  indexedDB?: IDBFactory;
  databaseName?: string;
};

export type TldrawRecoveryStore = {
  read: () => Promise<TldrawRecoveryDraft | null>;
  write: (draft: TldrawRecoveryDraft) => Promise<void>;
  clearIfCurrent: (draftId: string) => Promise<boolean>;
  close: () => Promise<void>;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")), { once: true });
  });
}

export function createTldrawRecoveryStore({
  indexedDB = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
}: RecoveryStoreOptions = {}): TldrawRecoveryStore {
  let databasePromise: Promise<IDBDatabase> | null = null;
  let operationQueue: Promise<void> = Promise.resolve();

  function database(): Promise<IDBDatabase> {
    if (!indexedDB) return Promise.reject(new Error("IndexedDB is unavailable"));
    databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const next = request.result;
        if (!next.objectStoreNames.contains(DRAFT_STORE)) next.createObjectStore(DRAFT_STORE);
      }, { once: true });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("Could not open local recovery storage")), { once: true });
      request.addEventListener("blocked", () => reject(new Error("Local recovery storage upgrade is blocked")), { once: true });
    });
    return databasePromise;
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  const read = () => enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const value: unknown = await requestResult(store.get(DOCUMENT_KEY));
    if (value !== undefined && !isTldrawRecoveryDraft(value)) store.delete(DOCUMENT_KEY);
    await transactionDone(transaction);
    return isTldrawRecoveryDraft(value) ? value : null;
  });

  const write = (draft: TldrawRecoveryDraft) => enqueue(async () => {
    if (!isTldrawRecoveryDraft(draft)) throw new Error("Invalid tldraw recovery draft");
    const db = await database();
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).put(draft, DOCUMENT_KEY);
    await transactionDone(transaction);
  });

  const clearIfCurrent = (draftId: string) => enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const value: unknown = await requestResult(store.get(DOCUMENT_KEY));
    const cleared = isTldrawRecoveryDraft(value) && value.id === draftId;
    if (cleared) store.delete(DOCUMENT_KEY);
    await transactionDone(transaction);
    return cleared;
  });

  const close = () => enqueue(async () => {
    const db = await databasePromise;
    db?.close();
    databasePromise = null;
  });

  return { read, write, clearIfCurrent, close };
}

export const tldrawRecoveryStore = createTldrawRecoveryStore();

