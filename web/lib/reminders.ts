/* Daily local reminders (native only) via @capacitor/local-notifications. Repeating notifications
   at a chosen time — no server/push needed. Prefs persist in localStorage; toggling reschedules. */
import { Capacitor } from "@capacitor/core";

export type Reminder = { id: number; key: string; label: string; enabled: boolean; hour: number; minute: number; title: string; body: string };

const STORE = "coach_reminders";

export const DEFAULT_REMINDERS: Reminder[] = [
  { id: 1001, key: "train", label: "Train", enabled: false, hour: 18, minute: 0,
    title: "Time to train", body: "Your session is waiting — even a short one counts." },
  { id: 1002, key: "log", label: "Log your day", enabled: false, hour: 20, minute: 30,
    title: "Log your day", body: "Food, weight, how you felt. Consistency beats any single day." },
];

export function loadReminders(): Reminder[] {
  try {
    const r = JSON.parse(localStorage.getItem(STORE) || "null");
    if (Array.isArray(r) && r.length) return DEFAULT_REMINDERS.map((d) => ({ ...d, ...(r.find((x: Reminder) => x.id === d.id) || {}) }));
  } catch { /* defaults */ }
  return DEFAULT_REMINDERS.map((r) => ({ ...r }));
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/* Persist + (re)schedule. Returns "ok" | "denied" | "web". */
export async function applyReminders(rs: Reminder[]): Promise<"ok" | "denied" | "web"> {
  localStorage.setItem(STORE, JSON.stringify(rs));
  if (!Capacitor.isNativePlatform()) return "web";
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== "granted") return "denied";
  await LocalNotifications.cancel({ notifications: rs.map((r) => ({ id: r.id })) });
  const on = rs.filter((r) => r.enabled);
  if (on.length) {
    await LocalNotifications.schedule({
      notifications: on.map((r) => ({
        id: r.id, title: r.title, body: r.body,
        schedule: { on: { hour: r.hour, minute: r.minute }, repeats: true, allowWhileIdle: true },
      })),
    });
  }
  return "ok";
}
