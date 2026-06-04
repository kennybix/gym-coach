/* Offline write queue (IndexedDB).
 *
 * EVERY write — online or offline — goes through this queue, so there is one code
 * path: enqueue, then try to flush. Server writes are idempotent (client-generated
 * UUIDs + ON CONFLICT DO NOTHING), so replaying a batch after a dropped connection
 * is always safe. Order is preserved (start -> sets -> complete) by flushing
 * sequentially and stopping at the first network failure.
 */
import { apiPost } from "./api";

export type QueueItem = {
  id: string; // uuid
  ts: number;
  path: string; // e.g. /api/sets/sync
  body: unknown;
};

const DB = "gymlog";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(path: string, body: unknown): Promise<void> {
  const item: QueueItem = { id: crypto.randomUUID(), ts: Date.now(), path, body };
  await withStore("readwrite", (s) => s.add(item));
  void flush(); // fire-and-forget; offline it just stays queued
}

export async function pendingCount(): Promise<number> {
  return withStore("readonly", (s) => s.count());
}

let flushing = false;

/** Replays queued writes oldest-first; stops at the first network failure. */
export async function flush(): Promise<void> {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return;
  flushing = true;
  try {
    const items = (await withStore("readonly", (s) => s.getAll())) as QueueItem[];
    items.sort((a, b) => a.ts - b.ts);
    for (const item of items) {
      try {
        await apiPost(item.path, item.body);
      } catch (err) {
        // 4xx = bad payload, will never succeed -> drop it; otherwise keep + stop.
        const msg = String(err);
        const m = msg.match(/-> (\d+)/);
        if (m && Number(m[1]) >= 400 && Number(m[1]) < 500) {
          await withStore("readwrite", (s) => s.delete(item.id));
          continue;
        }
        break;
      }
      await withStore("readwrite", (s) => s.delete(item.id));
    }
  } finally {
    flushing = false;
    notify();
  }
}

/* --- tiny subscription so the UI can show "N queued / offline" --------- */
type Listener = (count: number) => void;
const listeners = new Set<Listener>();

async function notify() {
  const n = await pendingCount().catch(() => 0);
  listeners.forEach((l) => l(n));
}

export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  void notify();
  return () => listeners.delete(l);
}

export function installQueueAutoFlush(): () => void {
  const onOnline = () => void flush();
  const onVisible = () => document.visibilityState === "visible" && void flush();
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void flush();
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
