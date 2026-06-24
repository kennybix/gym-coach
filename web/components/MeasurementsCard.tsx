"use client";
/* Body measurements on Trends — circumferences (cm) + body-fat %, one set per day (upserted).
   Each field shows its name ABOVE a full-width stepper (so the number is always visible in a
   2-col grid), with a "How to measure" guide since people don't always know where to measure. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import { localDate } from "@/lib/date";
import NumField from "./NumField";
import BodyMap from "./BodyMap";
import { navyBodyFat, waistToHeight } from "@/lib/bodyfat";

type Measurement = {
  date: string; note: string | null;
  waist_cm: number | null; belly_cm: number | null; chest_cm: number | null; hips_cm: number | null;
  arm_cm: number | null; thigh_cm: number | null; neck_cm: number | null; body_fat_pct: number | null;
};
type Profile = { sex: string | null; height_cm: number | null };

const SITES: { key: keyof Measurement; label: string; unit: string; step: number; tip: string }[] = [
  { key: "waist_cm", label: "Waist", unit: "cm", step: 0.5, tip: "Narrowest point of your torso — usually just above the navel. Relaxed, breathe out, don't suck in." },
  { key: "belly_cm", label: "Belly", unit: "cm", step: 0.5, tip: "Right around the navel (where the belly is widest). This is the one the body-fat estimate uses for men." },
  { key: "hips_cm", label: "Hips", unit: "cm", step: 0.5, tip: "Around the widest part of your hips and glutes, feet together." },
  { key: "chest_cm", label: "Chest", unit: "cm", step: 0.5, tip: "Across the fullest part, tape under the armpits and level all the way round." },
  { key: "arm_cm", label: "Arm", unit: "cm", step: 0.5, tip: "Around the biggest part of your upper arm (bicep), arm relaxed at your side." },
  { key: "thigh_cm", label: "Thigh", unit: "cm", step: 0.5, tip: "Around the largest part of your upper thigh, just below the glute." },
  { key: "neck_cm", label: "Neck", unit: "cm", step: 0.5, tip: "Just below the Adam's apple; let the tape slope slightly down at the front. Needed for the body-fat estimate." },
  { key: "body_fat_pct", label: "Body fat", unit: "%", step: 0.5, tip: "You don't need calipers — log your neck + belly (+ hips) and we estimate it for you below. Or type a smart-scale/caliper number here." },
];

export default function MeasurementsCard({ delay = 0 }: { delay?: number }) {
  const [list, setList] = useState<Measurement[]>([]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [help, setHelp] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return;
    apiGet<{ measurements: Measurement[]; profile: Profile | null }>("/api/measurements?limit=60")
      .then((d) => {
        setList(d.measurements);
        setProfile(d.profile);
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

  const save = async () => {
    const body: Record<string, number> = {};
    for (const s of SITES) { const n = vals[s.key]; if (n && n > 0) body[s.key] = n; }
    if (Object.keys(body).length === 0) return;
    // optimistic: show today's entry immediately
    const today = localDate();
    const optimistic: Measurement = {
      date: today, note: null, waist_cm: null, belly_cm: null, chest_cm: null, hips_cm: null,
      arm_cm: null, thigh_cm: null, neck_cm: null, body_fat_pct: null,
    };
    for (const s of SITES) { const n = vals[s.key]; if (n && n > 0) (optimistic as Record<string, unknown>)[s.key] = n; }
    setList((xs) => [optimistic, ...xs.filter((m) => m.date !== today)]);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    await enqueue("/api/measurements", body);
    load();
  };

  const remove = async (date: string) => {
    setList((xs) => xs.filter((m) => m.date !== date));
    await apiPost("/api/measurements/delete", { recorded_on: date });
  };

  // chronological (oldest -> newest) non-null values for a site
  const seriesFor = (key: keyof Measurement): number[] =>
    [...list].reverse().map((m) => m[key] as number | null).filter((x): x is number => x != null);

  const estBf = navyBodyFat({
    sex: profile?.sex ?? null, height: profile?.height_cm ?? null,
    waist: vals.waist_cm, belly: vals.belly_cm, neck: vals.neck_cm, hips: vals.hips_cm,
  });
  const whtr = waistToHeight(vals.waist_cm, profile?.height_cm ?? null);
  const female = (profile?.sex || "").toLowerCase().startsWith("f");

  return (
    <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-1">
        <p className="eyebrow">Body measurements</p>
        <button onClick={() => setHelp((v) => !v)} className="text-dim text-xs active:text-volt">
          {help ? "Hide" : "How to measure"}
        </button>
      </div>
      <p className="text-dim text-xs mb-2">Tape measure, on bare skin, relaxed. The figure shows where each one goes; fill in what you track.</p>

      <div className="mx-auto max-w-[220px] mb-1">
        <BodyMap vals={vals} sex={profile?.sex} />
      </div>

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

      {estBf != null ? (
        <div className="field p-3 mt-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-dim text-xs">Estimated body fat</p>
            <p className="font-display text-xl font-bold text-volt tnum leading-tight">{estBf}%</p>
            <p className="text-dim text-[11px]">US Navy method, from your measurements · an estimate</p>
          </div>
          <button onClick={() => setVals((p) => ({ ...p, body_fat_pct: estBf }))} className="btn btn-ghost h-9 px-3 text-sm shrink-0">Use this</button>
        </div>
      ) : profile ? (
        <p className="text-dim text-xs mt-3.5">
          Add your <span className="text-bone/80">neck</span> and <span className="text-bone/80">{female ? "waist + hips" : "belly"}</span> to estimate body fat automatically — no calipers needed.
        </p>
      ) : null}

      {whtr != null && (
        <p className="text-dim text-xs mt-2">
          Waist-to-height ratio <span className="text-bone/80 tnum">{whtr}</span>{whtr < 0.5 ? " · in the healthy range (under 0.5)" : " · general guideline is under 0.5"}
        </p>
      )}

      <button onClick={save} className="btn btn-primary w-full h-11 mt-3.5">
        {savedTick ? "Saved ✓" : "Log measurements"}
      </button>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {list.slice(0, 6).map((m) => {
            const parts = SITES.filter((s) => m[s.key] != null).map((s) => `${s.label} ${m[s.key]}${s.unit === "%" ? "%" : ""}`);
            return (
              <li key={m.date} className="py-2 text-sm flex items-baseline gap-2.5">
                <span className="text-bone/90 tnum truncate flex-1 min-w-0">{parts.join(" · ") || "—"}</span>
                <span className="text-dim text-[11px] shrink-0">{new Date(m.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <button onClick={() => remove(m.date)} aria-label="delete entry" className="text-dim hover:text-alert px-1 text-base leading-none shrink-0">×</button>
              </li>
            );
          })}
        </ul>
      )}

      {SITES.some((s) => seriesFor(s.key).length >= 2) && (
        <div className="mt-4">
          <p className="eyebrow mb-2">Trends</p>
          <div className="space-y-2">
            {SITES.filter((s) => seriesFor(s.key).length >= 2).map((s) => {
              const v = seriesFor(s.key);
              const ch = +(v[v.length - 1] - v[0]).toFixed(1);
              return (
                <div key={s.key as string} className="flex items-center gap-3">
                  <span className="text-dim text-xs w-14 shrink-0 truncate">{s.label}</span>
                  <MiniSpark values={v} />
                  <span className="tnum text-bone/90 text-sm ml-auto">{v[v.length - 1]}{s.unit === "%" ? "%" : ""}</span>
                  <span className={`tnum text-xs shrink-0 w-11 text-right ${ch === 0 ? "text-dim" : ch < 0 ? "text-volt" : "text-alert"}`}>
                    {ch > 0 ? "+" : ""}{ch}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 70, h = 20, pad = 2;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (val: number) => pad + (1 - (val - lo) / span) * (h - 2 * pad);
  const d = values.map((val, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0">
      <path d={d} fill="none" stroke="var(--color-volt)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="1.8" fill="var(--color-volt)" />
    </svg>
  );
}
