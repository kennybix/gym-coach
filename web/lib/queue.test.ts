import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the API layer so we control how each replayed write resolves/throws. apiPost throws
// Error("... -> <status>") on HTTP errors (that's how flush reads the status) and a TypeError
// on a network failure.
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./api", () => ({ apiPost: post }));

import { enqueue, flush, pendingCount } from "./queue";

const httpErr = (status: number) => new Error(`POST /api/x -> ${status}`);
const netErr = () => new TypeError("Failed to fetch");

// Clear the store (not deleteDatabase — that blocks while the queue's connections stay open).
function resetDb(): Promise<void> {
  return new Promise((res, rej) => {
    const open = indexedDB.open("gymlog", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pending", { keyPath: "id" });
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").clear();
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
    open.onerror = () => rej(open.error);
  });
}

describe("offline write queue flush()", () => {
  beforeEach(async () => {
    post.mockReset();
    await resetDb();
  });

  it("delivers and removes a write on success", async () => {
    post.mockResolvedValue({});
    await enqueue("/api/x", { a: 1 });
    expect(await pendingCount()).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("drops a 4xx (bad payload) instead of retrying forever", async () => {
    post.mockRejectedValue(httpErr(422));
    await enqueue("/api/x", {});
    expect(await pendingCount()).toBe(0); // dropped
  });

  it("keeps an item on a network error (retry later), doesn't drop", async () => {
    post.mockRejectedValue(netErr());
    await enqueue("/api/x", {});
    expect(await pendingCount()).toBe(1);
  });

  it("retries a 5xx and drops only after MAX_ATTEMPTS", async () => {
    post.mockRejectedValue(httpErr(500));
    await enqueue("/api/x", {}); // attempt 1 — kept
    expect(await pendingCount()).toBe(1);
    for (let i = 0; i < 6; i++) await flush(); // exhaust attempts
    expect(await pendingCount()).toBe(0); // poison item dropped, queue unjammed
  });

  it("a stuck 5xx item does NOT block an independent write behind it (no head-of-line jam)", async () => {
    post.mockImplementation((path: string) =>
      path === "/api/bad" ? Promise.reject(httpErr(500)) : Promise.resolve({})
    );
    await enqueue("/api/bad", {}); // 5xx -> kept
    await enqueue("/api/good", {}); // its flush should still deliver /api/good
    expect(post).toHaveBeenCalledWith("/api/good", expect.anything());
    expect(await pendingCount()).toBe(1); // only the bad one remains
  });
});
