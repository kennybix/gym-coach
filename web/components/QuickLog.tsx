"use client";
/* Quick-log sheets launched from Home's tiles. Each is one number (or three), one Save, and
   it's gone. Writes go through the offline queue like every other log. */
import { useEffect, useState } from "react";
import { enqueue } from "@/lib/queue";
import { localDate } from "@/lib/date";
import NumField from "./NumField";
import Sheet from "./ui/Sheet";

const TAGS = ["resting", "morning", "post-workout"];

export function WeighInSheet({
  open,
  onClose,
  latestKg,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  latestKg: number | null;
  onSaved?: (kg: number) => void;
}) {
  const [kg, setKg] = useState(latestKg ?? 80);
  useEffect(() => {
    if (open) setKg(latestKg ?? 80);
  }, [open, latestKg]);

  const save = async () => {
    void enqueue("/api/metrics/weight/set", { recorded_on: localDate(), weight_kg: kg });
    if (navigator.vibrate) navigator.vibrate(12);
    onSaved?.(kg);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow={todayLabel()} title="Weigh in">
      <NumField value={kg} onChange={setKg} step={0.5} min={20} max={400} decimals={1} unit="kg" />
      {latestKg != null && (
        <p className="t-sec mt-2 tnum">Last weigh-in {latestKg.toFixed(1)} kg. Tap the number to type.</p>
      )}
      <button onClick={save} className="btn btn-primary w-full h-14 mt-5 text-base">Save weigh-in</button>
    </Sheet>
  );
}

export function VitalsSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [sys, setSys] = useState(120);
  const [dia, setDia] = useState(80);
  const [hr, setHr] = useState(70);
  const [withHr, setWithHr] = useState(true);
  const [tag, setTag] = useState("");

  const save = async () => {
    void enqueue("/api/vitals", {
      id: crypto.randomUUID(),
      recorded_at: new Date().toISOString(),
      systolic: sys,
      diastolic: dia,
      heart_rate: withHr ? hr : null,
      tag: tag || null,
      note: null,
    });
    if (navigator.vibrate) navigator.vibrate(12);
    onSaved?.();
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow={todayLabel()} title="Blood pressure">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><NumField value={sys} onChange={setSys} step={1} min={50} max={260} unit="sys" /></div>
        <span className="text-dim text-2xl font-display">/</span>
        <div className="flex-1 min-w-0"><NumField value={dia} onChange={setDia} step={1} min={30} max={160} unit="dia" /></div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button data-on={withHr} onClick={() => setWithHr((v) => !v)} className="seg h-12 px-4 text-sm shrink-0">Heart rate</button>
        <div className={`flex-1 min-w-0 ${withHr ? "" : "opacity-40 pointer-events-none"}`}>
          <NumField value={hr} onChange={setHr} step={1} min={30} max={230} unit="bpm" compact />
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap mt-3">
        {TAGS.map((t) => (
          <button key={t} onClick={() => setTag((c) => (c === t ? "" : t))} className={`chip px-3 py-1.5 text-xs capitalize ${tag === t ? "chip-on" : "text-dim"}`}>
            {t}
          </button>
        ))}
      </div>
      <button onClick={save} className="btn btn-primary w-full h-14 mt-5 text-base">Save reading</button>
    </Sheet>
  );
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
