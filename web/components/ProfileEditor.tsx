"use client";
/* Edit the details captured at onboarding (the `profiles` row): sex, birth year, height,
   activity, goal. These power the body-fat estimate, the energy maths, and the body figure —
   so being able to fix them matters. Weight is NOT here (it's a weigh-in, edited on Trends). */
import { useEffect, useState } from "react";
import { apiGet, apiPost, configured } from "@/lib/api";
import NumField from "./NumField";

type Profile = {
  sex: string; birth_year: number; height_cm: number;
  activity_level: string; goal_weight_kg: number; weekly_rate_kg: number;
};
const ACTIVITY = ["sedentary", "light", "moderate", "active"];

export default function ProfileEditor() {
  const [p, setP] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!configured()) return;
    apiGet<Profile>("/api/profile")
      .then(setP)
      .catch(() => setMsg("Finish onboarding first, then your details show up here."));
  }, []);

  if (!p) return msg ? <div className="card p-5 rise"><p className="text-dim text-xs">{msg}</p></div> : null;

  const set = (patch: Partial<Profile>) => setP((prev) => ({ ...prev!, ...patch }));
  const save = async () => {
    await apiPost("/api/profile", p);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const year = new Date().getFullYear();
  const age = p.birth_year ? year - p.birth_year : null;

  return (
    <div className="card p-5 rise space-y-4">
      <div>
        <p className="eyebrow">Your details</p>
        <p className="text-dim text-xs mt-1 leading-relaxed">
          Powers the body-fat estimate, energy maths and the body figure. Stored privately on your own machine.
        </p>
      </div>

      <label className="block">
        <span className="text-dim text-xs">Sex</span>
        <select value={p.sex} onChange={(e) => set({ sex: e.target.value })} className="field mt-1 w-full h-11 px-3 text-sm outline-none capitalize">
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-dim text-xs mb-1 truncate">Birth year{age ? ` · age ${age}` : ""}</p>
          <NumField value={p.birth_year} onChange={(v) => set({ birth_year: Math.round(v) })} step={1} min={1920} max={year} compact />
        </div>
        <div className="min-w-0">
          <p className="text-dim text-xs mb-1">Height</p>
          <NumField value={p.height_cm} onChange={(v) => set({ height_cm: v })} step={0.5} min={100} max={250} decimals={1} unit="cm" compact />
        </div>
      </div>

      <label className="block">
        <span className="text-dim text-xs">Activity level</span>
        <select value={p.activity_level} onChange={(e) => set({ activity_level: e.target.value })} className="field mt-1 w-full h-11 px-3 text-sm outline-none capitalize">
          {ACTIVITY.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-dim text-xs mb-1">Goal weight</p>
          <NumField value={p.goal_weight_kg} onChange={(v) => set({ goal_weight_kg: v })} step={0.5} min={30} max={400} decimals={1} unit="kg" compact />
        </div>
        <div className="min-w-0">
          <p className="text-dim text-xs mb-1 truncate">Weekly rate</p>
          <NumField value={p.weekly_rate_kg} onChange={(v) => set({ weekly_rate_kg: v })} step={0.05} min={0} max={1} decimals={2} unit="kg" compact />
        </div>
      </div>

      <button onClick={save} className="btn btn-primary w-full h-12">{saved ? "Saved ✓" : "Save details"}</button>
      <p className="text-dim text-[11px]">Changing your goal rate won&apos;t move your calorie target on its own — your coach adjusts that from real data.</p>
    </div>
  );
}
