/**
 * expo-secure-store 的 Web 替身：只把「配对凭证」写进 IndexedDB（契约 C3/C6）。
 * 接口与 expo-secure-store 同名，credential-store.ts 无需改动业务逻辑。
 * 非安全上下文下 IndexedDB 仍可用；不可用时退到进程内内存，保证页面不至于打不开。
 */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

const DB_NAME = 'easymint-web-v1';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    // IndexedDB 可能因隐私模式 / 被阻塞 / 浏览器节流而既不给 success 也不给 error。
    // 超时后退回进程内内存，保证「未配对引导页」在任何环境都能出首帧，不会白屏。
    const timer = setTimeout(() => resolve(null), 1000);
    const settle = (value: IDBDatabase | null): void => {
      clearTimeout(timer);
      resolve(value);
    };
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => settle(request.result);
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    } catch {
      settle(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function getItemAsync(key: string): Promise<string | null> {
  const value = await tx<string>('readonly', (store) => store.get(key) as IDBRequest<string>);
  return value ?? memory.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string, _options?: unknown): Promise<void> {
  memory.set(key, value);
  await tx<IDBValidKey>('readwrite', (store) => store.put(value, key));
}

export async function deleteItemAsync(key: string, _options?: unknown): Promise<void> {
  memory.delete(key);
  await tx<undefined>('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
}
