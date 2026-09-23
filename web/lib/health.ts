/* Health Connect bridge (native Android only).
   Reads Weight + Blood Pressure + Resting Heart Rate from Health Connect and pushes them into
   the app via the normal idempotent endpoints — weight per-day upsert, vitals keyed by the
   Health Connect record id so re-syncs don't duplicate. No-op on the web build. */
import { Capacitor } from "@capacitor/core";
import { apiBase, token } from "./api";

export const isNative = () => Capacitor.isNativePlatform();

type Mass = { unit: string; value: number };
const READ = ["Weight", "BloodPressure", "RestingHeartRate"] as const;

function toKg(m: Mass): number {
  const v = m.value;
  switch (m.unit) {
    case "gram": return v / 1000;
    case "milligram": return v / 1e6;
    case "ounce": return v * 0.0283495;
    case "pound": return v * 0.453592;
    default: return v; // kilogram
  }
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type HealthSync = { weights: number; vitals: number } | { error: string };

export async function syncHealthConnect(days = 90): Promise<HealthSync> {
  if (!isNative()) return { error: "not_native" };
  try {
    const { HealthConnect } = await import("@kiwi-health/capacitor-health-connect");
    const { availability } = await HealthConnect.checkAvailability();
    if (availability !== "Available") return { error: availability }; // NotInstalled | NotSupported

    const read = [...READ] as unknown as Parameters<typeof HealthConnect.requestHealthPermissions>[0]["read"];
    await HealthConnect.requestHealthPermissions({ read, write: [] });

    const filter = { type: "after", time: new Date(Date.now() - days * 86400000) } as const;
    let weights = 0, vitals = 0;

    // Weight -> per-day upsert (idempotent by day)
    const w = await HealthConnect.readRecords({ type: "Weight", timeRangeFilter: filter });
    for (const r of w.records as unknown as { weight: Mass; time: string }[]) {
      const day = new Date(r.time).toISOString().slice(0, 10);
      if (await post("/api/metrics/weight/set", { recorded_on: day, weight_kg: Math.round(toKg(r.weight) * 10) / 10 })) weights++;
    }

    // Blood pressure -> vitals, keyed by the Health Connect record id (idempotent)
    const bp = await HealthConnect.readRecords({ type: "BloodPressure", timeRangeFilter: filter });
    for (const r of bp.records as unknown as { metadata: { id: string }; time: string; systolic: { value: number }; diastolic: { value: number } }[]) {
      if (await post("/api/vitals", { id: r.metadata.id, recorded_at: new Date(r.time).toISOString(),
        systolic: Math.round(r.systolic.value), diastolic: Math.round(r.diastolic.value), heart_rate: null, tag: "import", note: "Health Connect" })) vitals++;
    }

    // Resting heart rate -> vitals
    const hr = await HealthConnect.readRecords({ type: "RestingHeartRate", timeRangeFilter: filter });
    for (const r of hr.records as unknown as { metadata: { id: string }; time: string; beatsPerMinute: number }[]) {
      if (await post("/api/vitals", { id: r.metadata.id, recorded_at: new Date(r.time).toISOString(),
        systolic: null, diastolic: null, heart_rate: Math.round(r.beatsPerMinute), tag: "resting", note: "Health Connect" })) vitals++;
    }

    return { weights, vitals };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "sync_failed" };
  }
}

/* ---- silent background sync -------------------------------------------------------------------
   Only after the user has synced once by hand (so permissions are granted and we never pop a
   permission screen on app open), and at most every 6 hours. Pulls the last 14 days; the endpoints
   are idempotent so overlap is harmless. */
const AUTO_KEY = "hc_auto";          // "1" once a manual sync succeeded
const LAST_KEY = "hc_last_sync";     // epoch ms of the last successful sync
const AUTO_EVERY_MS = 6 * 3600 * 1000;

export function markHealthSynced() {
  try {
    localStorage.setItem(AUTO_KEY, "1");
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

export async function autoSyncHealth(): Promise<HealthSync | null> {
  if (!isNative()) return null;
  try {
    if (localStorage.getItem(AUTO_KEY) !== "1") return null;
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    if (Date.now() - last < AUTO_EVERY_MS) return null;
    localStorage.setItem(LAST_KEY, String(Date.now())); // claim the slot before the slow work
  } catch {
    return null;
  }
  const r = await syncHealthConnect(14);
  if (!("error" in r) && (r.weights || r.vitals)) {
    window.dispatchEvent(new CustomEvent("coach:health-synced", { detail: r }));
  }
  return r;
}
