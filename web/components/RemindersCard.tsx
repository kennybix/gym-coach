"use client";
/* Daily reminders (Setup) — a nudge to train and to log, scheduled as local notifications on the
   device. Native only; in a browser it explains that reminders need the installed app. */
import { useEffect, useState } from "react";
import { applyReminders, isNative, loadReminders, type Reminder } from "@/lib/reminders";

const pad = (n: number) => String(n).padStart(2, "0");

export default function RemindersCard() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [native, setNative] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setReminders(loadReminders()); setNative(isNative()); }, []);

  const update = async (next: Reminder[]) => {
    setReminders(next);
    const r = await applyReminders(next);
    setMsg(
      r === "denied" ? "Allow notifications for Gym Coach in Android settings to get reminders."
      : r === "web" ? "Reminders run in the installed app, not the browser."
      : null
    );
  };
  const toggle = (id: number) => update(reminders.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  const setTime = (id: number, t: string) => {
    const [h, m] = t.split(":").map(Number);
    update(reminders.map((r) => (r.id === id ? { ...r, hour: h, minute: m } : r)));
  };

  if (!native) {
    return (
      <div className="card p-5 rise">
        <p className="eyebrow mb-1">Reminders</p>
        <p className="text-dim text-xs leading-relaxed">Daily reminders to train and log work in the installed app (not the browser).</p>
      </div>
    );
  }

  return (
    <div className="card p-5 rise space-y-3">
      <div>
        <p className="eyebrow">Reminders</p>
        <p className="text-dim text-xs mt-1">A daily nudge to train and to log — on this device only.</p>
      </div>
      {reminders.map((r) => (
        <div key={r.id} className="field p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{r.label}</p>
            <input
              type="time" value={`${pad(r.hour)}:${pad(r.minute)}`} onChange={(e) => setTime(r.id, e.target.value)}
              disabled={!r.enabled}
              className="field h-8 px-2 text-xs tnum mt-1.5 outline-none disabled:opacity-50"
            />
          </div>
          <button onClick={() => toggle(r.id)} className={`chip px-2.5 py-1 text-[11px] font-semibold shrink-0 ${r.enabled ? "text-onvolt bg-volt border-volt" : "text-dim"}`}>
            {r.enabled ? "On" : "Off"}
          </button>
        </div>
      ))}
      {msg && <p className="text-dim text-xs">{msg}</p>}
    </div>
  );
}
