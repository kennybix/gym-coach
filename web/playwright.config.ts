import { defineConfig, devices } from "@playwright/test";

/* E2E smoke against a RUNNING local stack (backend :8010 + frontend :3010) with real data —
   deliberately read-only (see e2e/smoke.spec.ts). Run:
     TK=$(python ../mint_token.py <uuid> | awk '/token:/{print $2}') npm run test:e2e
   Not part of `npm test`/CI — CI has no stack; this is the local pre-release gate. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3010",
    ...devices["Pixel 7"],
  },
});
