"use client";
/* Body measurements on Trends — circumferences (cm) + body-fat %, one set per day (upserted).
   Each field shows its name ABOVE a full-width stepper (so the number is always visible in a
   2-col grid), with a "How to measure" guide since people don't always know where to measure. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import NumField from "./NumField";

type Measurement = {
  date: string; note: string | null;
  waist_cm: number | null; chest_cm: number | null; hips_cm: number | null;
  arm_cm: number | null; thigh_cm: number | null; neck_cm: number | null; body_fat_pct: number | null;
};

const SITES: { key: keyof Measurement; label: string; unit: string; step: number; tip: string }[] = [
  { key: "waist_cm", label: "Waist", unit: "cm", step: 0.5, tip: "Around the narrowest point — usually just above the navel. Stand relaxed, breathe out, don't suck in." },
  { key: "hips_cm", label: "Hips", unit: "cm", step: 0.5, tip: "Around the widest part of your hips and glutes, feet together." },
  { key: "chest_cm", label: "Chest", unit: "cm", step: 0.5, tip: "Across the fullest part, tape under the armpits and level all the way round." },
  { key: "arm_cm", label: "Arm", unit: "cm", step: 0.5, tip: "Around the biggest part of your upper arm (bicep), arm relaxed at your side." },
  { key: "thigh_cm", label: "Thigh", unit: "cm", step: 0.5, tip: "Around the largest part of your upper thigh, just below the glute." },
  { key: "neck_cm", label: "Neck", unit: "cm", step: 0.5, tip: "Just below the Adam's apple; let the tape slope slightly down at the front." },
  { key: "body_fat_pct", label: "Body fat", unit: "%", step: 0.5, tip: "From a smart scale, calipers, or a body-fat estimate — enter the % only if you have it." },
];

export default function MeasurementsCard({ delay = 0 }: { delay?: number }) {
  const [list, setList] = useState<Measurement[]>([]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [savedTick, setSavedTick] = useState(false);
  const [help, setHelp] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return;
    apiGet<{ measurements: Measurement[] }>("/api/measurements?limit=60")
      .then((d) => {
        setList(d.measurements);
        const latest = d.measurements[0];
        if (latest) {
          const v: Record<string, number> = {};
          for (const s of SITES) { const n = latest[s.key] as number | null; if (n != null) v[s.key] = n; }
          setVals(v);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const save = () => {
    const body: Record<string, number> = {};
    for (const s of SITES) { const n = vals[s.key]; if (n && n > 0) body[s.key] = n; }
    if (Object.keys(body).length === 0) return;
    void enqueue("/api/measurements", body);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    setTimeout(load, 400);
  };

  const change = (key: keyof Measurement): number | null => {
    const pts = [...list].reverse().map((m) => m[key] as number | null).filter((x): x is number => x != null);
    return pts.length >= 2 ? +(pts[pts.length - 1] - pts[0]).toFixed(1) : null;
  };

  return (
    <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-1">
        <p className="eyebrow">Body measurements</p>
        <button onClick={() => setHelp((v) => !v)} className="text-dim text-xs active:text-volt">
          {help ? "Hide" : "How to measure"}
        </button>
      </div>
      <p className="text-dim text-xs mb-3.5">Tape measure, on bare skin, relaxed. Fill in what you track — leave the rest at 0.</p>

      {help && (
        <ul className="mb-4 space-y-1.5 text-xs leading-snug">
          {SITES.map((s) => (
            <li key={s.key as string}>
              <span className="text-bone/90 font-medium">{s.label}:</span> <span className="text-dim">{s.tip}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
        {SITES.map((s) => (
          <div key={s.key as string} className="min-w-0">
            <p className="text-dim text-xs mb-1 truncate">{s.label}</p>
            <NumField
              unit={s.unit}
              value={vals[s.key] ?? 0}
              onChange={(v) => setVals((p) => ({ ...p, [s.key]: v }))}
              step={s.step}
              min={0}
              max={s.unit === "%" ? 70 : 300}
              decimals={1}
              compact
            />
          </div>
        ))}
      </div>

      <button onClick={save} className="btn btn-primary w-full h-11 mt-3.5">
        {savedTick ? "Saved ✓" : "Log measurements"}
      </button>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {list.slice(0, 6).map((m) => {
            const parts = SITES.filter((s) => m[s.key] != null).map((s) => `${s.label} ${m[s.key]}${s.unit === "%" ? "%" : ""}`);
            return (
              <li key={m.date} className="py-2 text-sm flex items-baseline justify-between gap-3">
                <span className="text-bone/90 tnum truncate">{parts.join(" · ") || "—"}</span>
                <span className="text-dim text-[11px] shrink-0">{new Date(m.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </li>
            );
          })}
        </ul>
      )}

      {change("waist_cm") != null && (
        <p className="text-dim text-xs mt-2">
          Waist {change("waist_cm")! <= 0 ? "down" : "up"} {Math.abs(change("waist_cm")!)} cm over the last {list.length} entries.
        </p>
      )}
    </div>
  );
}
