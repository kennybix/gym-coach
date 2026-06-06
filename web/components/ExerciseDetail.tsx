"use client";
/* Per-exercise progression: lifetime bests + an estimated-1RM-over-time chart. Opened from a
   tap on the exercise on Today. Read-only; data from /api/exercise/{id}/stats. */
import { useEffect, useState } from "react";
import { exerciseStats, type ExerciseStats } from "@/lib/api";
import ExerciseAnimation from "./ExerciseAnimation";

export default function ExerciseDetail({
  exerciseId,
  name,
  frames,
  onClose,
}: {
  exerciseId: string;
  name: string;
  frames: string[];
  onClose: () => void;
}) {
  const [stats, setStats] = useState<ExerciseStats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    exerciseStats(exerciseId)
      .then((s) => live && setStats(s))
      .catch(() => live && setErr(true));
    return () => { live = false; };
  }, [exerciseId]);

  return (
    <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[85dvh] overflow-auto scroll-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <ExerciseAnimation frames={frames} alt={name} className="w-12 h-12 rounded-lg shrink-0 border border-line" />
          <h2 className="font-display font-semibold leading-tight flex-1 min-w-0">{name}</h2>
          <button onClick={onClose} className="btn btn-primary h-9 px-4 text-sm shrink-0">Done</button>
        </div>

        {err && <p className="text-dim text-sm">Couldn&apos;t load stats — try again when you&apos;re online.</p>}
        {!err && !stats && <div className="h-40 card animate-pulse" />}

        {stats && (stats.total_sets === 0 ? (
          <p className="text-dim text-sm leading-relaxed">
            No logged sets for this exercise yet. Log a few and your estimated-1RM progression and
            personal bests will show up here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Best est. 1RM" value={stats.best_e1rm != null ? `${stats.best_e1rm} kg` : "—"} accent />
              <Stat label="Heaviest" value={stats.heaviest_kg != null ? `${stats.heaviest_kg} kg` : "—"} />
              <Stat label="Total sets" value={String(stats.total_sets)} />
              <Stat label="Total volume" value={`${stats.total_volume.toLocaleString()} kg`} />
            </div>

            {stats.best_set && (
              <p className="text-dim text-xs mt-3">
                Best set: <span className="text-bone/90 tnum">{stats.best_set.weight_kg} kg × {stats.best_set.reps}</span>
                {" "}(est. 1RM {stats.best_set.e1rm} kg)
              </p>
            )}

            <p className="eyebrow mt-5 mb-2">Estimated 1RM over time</p>
            {stats.series.length >= 2 ? (
              <E1rmChart series={stats.series} />
            ) : (
              <p className="text-dim text-xs">Log this exercise across more sessions to see the trend line.</p>
            )}
          </>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="field p-3">
      <p className="text-dim text-xs">{label}</p>
      <p className={`font-display tnum text-xl font-bold mt-0.5 ${accent ? "text-volt" : ""}`}>{value}</p>
    </div>
  );
}

function E1rmChart({ series }: { series: ExerciseStats["series"] }) {
  const W = 320, H = 110, pad = 6;
  const vals = series.map((s) => s.e1rm);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (series.length - 1)) * (W - 2 * pad) + pad;
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const d = series.map((s, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(s.e1rm).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <div className="field p-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
        <path d={d} fill="none" stroke="var(--color-volt)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.e1rm)} r="2" fill="var(--color-volt)" />
        ))}
      </svg>
      <div className="flex justify-between text-dim text-[11px] tnum mt-1.5">
        <span>{series[0].date.slice(5)}</span>
        <span className="text-bone/80">now {last.e1rm} kg</span>
      </div>
    </div>
  );
}
