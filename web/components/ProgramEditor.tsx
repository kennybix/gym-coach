"use client";
/* Edit the active program: add (multi-select), reorder, retarget sets×reps, remove.
   Saves via POST /api/program, which REPLACES the active program (old versions kept
   inactive for history). Reachable from Today and Setup. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, configured } from "@/lib/api";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import ExerciseAnimation from "./ExerciseAnimation";

type Picked = {
  exercise_id: string; name: string; equipment: string;
  category?: string | null; image_urls?: string[];
  sets?: number; reps?: number; // undefined for cardio (logged by time/distance)
};
type Slot = { exercise_id: string; name: string; equipment: string; category?: string | null; image_urls?: string[]; sets: number | null; reps: number | null };
type TodayResp = { slots: Slot[]; program: { name: string; sessions_per_week: number } | null };
const isCardio = (p: { category?: string | null }) => p.category === "cardio";

export default function ProgramEditor() {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [perWeek, setPerWeek] = useState(3);
  const [name, setName] = useState("Main");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured()) {
      setReady(true);
      return;
    }
    apiGet<TodayResp>("/api/program/today")
      .then((d) => {
        setPicked(
          d.slots.map((s) => ({
            exercise_id: s.exercise_id,
            name: s.name,
            equipment: s.equipment,
            category: s.category,
            image_urls: s.image_urls,
            sets: s.category === "cardio" ? undefined : (s.sets ?? 3),
            reps: s.category === "cardio" ? undefined : (s.reps ?? 8),
          }))
        );
        if (d.program) {
          setPerWeek(d.program.sessions_per_week);
          setName(d.program.name);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const add = (r: CatalogRow) =>
    setPicked((p) =>
      p.some((x) => x.exercise_id === r.exercise_id)
        ? p.filter((x) => x.exercise_id !== r.exercise_id) // tap again to remove
        : [...p, {
            exercise_id: r.exercise_id, name: r.name, equipment: r.equipment,
            category: r.category, image_urls: r.image_urls,
            sets: r.category === "cardio" ? undefined : 3,
            reps: r.category === "cardio" ? undefined : 8,
          }]
    );
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.exercise_id !== id));
  const tweak = (id: string, k: "sets" | "reps", d: number) =>
    setPicked((p) => p.map((x) => (x.exercise_id === id ? { ...x, [k]: Math.max(1, (x[k] ?? 1) + d) } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setPicked((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = p.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/program", {
        name,
        sessions_per_week: perWeek,
        exercises: picked.map((p) =>
          isCardio(p) ? { exercise_id: p.exercise_id } : { exercise_id: p.exercise_id, sets: p.sets, reps: p.reps }
        ),
      });
      router.push("/");
    } catch {
      setError("Couldn't save — check your connection and token.");
      setBusy(false);
    }
  };

  if (!ready) return <div className="card p-5 h-32 animate-pulse" />;

  return (
    <div className="space-y-5 pb-4">
      <header className="flex items-center justify-between rise">
        <div>
          <p className="eyebrow">Edit</p>
          <h1 className="font-display text-[28px] font-bold mt-1.5">Program</h1>
        </div>
        <button onClick={() => router.push("/")} className="btn btn-ghost h-9 px-4 text-sm">Cancel</button>
      </header>

      <div className="card p-5 rise space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-bone/90 font-medium">Sessions per week</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setPerWeek((v) => Math.max(1, v - 1))} className="w-9 h-9 rounded-lg field text-xl text-dim active:text-volt">−</button>
            <span className="font-display tnum text-xl font-bold w-6 text-center">{perWeek}</span>
            <button onClick={() => setPerWeek((v) => Math.min(7, v + 1))} className="w-9 h-9 rounded-lg field text-xl text-dim active:text-volt">+</button>
          </div>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="space-y-2.5 rise">
          <p className="eyebrow">Your exercises · {picked.length}</p>
          {picked.map((p, i) => (
            <div key={p.exercise_id} className="card p-3.5 space-y-3">
              <div className="flex items-center gap-3">
                <ExerciseAnimation frames={p.image_urls ?? []} alt={p.name} className="w-11 h-11 rounded-lg shrink-0 border border-line" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-dim text-xs capitalize">{p.equipment}{isCardio(p) ? " · cardio" : ""}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="w-8 h-8 rounded-lg field text-dim active:text-volt disabled:opacity-30">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === picked.length - 1} className="w-8 h-8 rounded-lg field text-dim active:text-volt disabled:opacity-30">↓</button>
                  <button onClick={() => remove(p.exercise_id)} className="w-8 h-8 rounded-lg text-alert text-xl leading-none">×</button>
                </div>
              </div>
              {isCardio(p) ? (
                <p className="text-dim text-xs">Cardio — you&apos;ll log time &amp; distance on the Today screen.</p>
              ) : (
                <div className="flex gap-2">
                  <RepBox label="sets" value={p.sets ?? 3} onDown={() => tweak(p.exercise_id, "sets", -1)} onUp={() => tweak(p.exercise_id, "sets", 1)} />
                  <RepBox label="reps" value={p.reps ?? 8} onDown={() => tweak(p.exercise_id, "reps", -1)} onUp={() => tweak(p.exercise_id, "reps", 1)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card p-5 rise">
        <p className="eyebrow mb-3">Add exercises</p>
        <CatalogSearch onPick={add} pickedIds={picked.map((p) => p.exercise_id)} />
      </div>

      {error && <p className="text-alert text-xs px-1">{error}</p>}

      <div
        className="sticky z-20"
        style={{ bottom: "calc(70px + env(safe-area-inset-bottom))" }}
      >
        <button onClick={save} disabled={busy || picked.length === 0} className="btn btn-primary w-full h-[3.25rem] shadow-lg">
          {busy ? "Saving…" : picked.length === 0 ? "Add at least one exercise" : `Save program · ${picked.length}`}
        </button>
      </div>
    </div>
  );
}

function RepBox({ label, value, onDown, onUp }: { label: string; value: number; onDown: () => void; onUp: () => void }) {
  return (
    <div className="field flex items-center flex-1 h-11">
      <span className="pl-3 text-dim text-xs w-10">{label}</span>
      <button onClick={onDown} className="w-9 h-11 text-xl text-dim active:text-volt">−</button>
      <span className="flex-1 text-center font-display tnum font-bold">{value}</span>
      <button onClick={onUp} className="w-9 h-11 text-xl text-dim active:text-volt rounded-r-[0.9rem]">+</button>
    </div>
  );
}
