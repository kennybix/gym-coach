import { defineConfig } from "vitest/config";

// Unit tests for browser-side logic (offline queue, helpers). jsdom gives us navigator/crypto;
// fake-indexeddb (imported per-test) gives us IndexedDB.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["lib/**/*.test.ts"],
  },
});
