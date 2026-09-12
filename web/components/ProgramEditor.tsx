"use client";
/* Edit ONE program: compact rows, drag a handle to reorder, inline sets × reps, add exercises
   from a sheet, save. Saves in place via /api/programs/update (never touches other programs). */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, configured } from "@/lib/api";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import ExerciseAnimation from "./ExerciseAnimation";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";

type Picked = { exercise_id: string; name: string; equipment: string; category?: string | null; image_urls?: string[]; sets?: number; reps?: number };
type ProgramDetail = {
  program_id: string; name: string; goal: string | null; sessions_per_week: number;
  exercises: { exercise_id: string; name: string; equipment: string; category: string | null; image_urls: string[]; sets: number | null; reps: number | null }[];
};
const isCardio = (p: { category?: string | null }) => p.category === "cardio";
const ROW_H = 76;

export default function ProgramEditor({ programId }: { programId: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [perWeek, setPerWeek] = useState(3);
  const [name, setName] = useState("Main");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const dragRef = useRef<{ from: number; startY: number } | null>(null);

  useEffect(() => {
    if (!configured()) return setReady(true);
    apiGet<ProgramDetail>(`/api/programs/${programId}`)
      .then((d) => {
        setPicked(d.exercises.map((s) => ({
          exercise_id: s.exercise_id, name: s.name, equipment: s.equipment, category: s.category, image_urls: s.image_urls,
          sets: s.category === "cardio" ? undefined : (s.sets ?? 3), reps: s.category === "cardio" ? undefined : (s.reps ?? 8),
        })));
        setPerWeek(d.sessions_per_week); setName(d.name);
      })
      .catch(() => setError("Couldn't load this program."))
      .finally(() => setReady(true));
  }, [programId]);

  const add = (r: CatalogRow) => setPicked((p) => p.some((x) => x.exercise_id === r.exercise_id)
    ? p.filter((x) => x.exercise_id !== r.exercise_id)
    : [...p, { exercise_id: r.exercise_id, name: r.name, equipment: r.equipment, category: r.category, image_urls: r.image_urls, sets: r.category === "cardio" ? undefined : 3, reps: r.category === "cardio" ? undefined : 8 }]);
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.exercise_id !== id));
  const tweak = (id: string, k: "sets" | "reps", d: number) =>
    setPicked((p) => p.map((x) => (x.exercise_id === id ? { ...x, [k]: Math.max(1, (x[k] ?? 1) + d) } : x)));

  /* drag-to-reorder: pointer events on the handle; target index from vertical travel */
  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { from: i, startY: e.clientY };
    setDrag({ from: i, to: i, dy: 0 });
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = e.clientY - dragRef.current.startY;
    const to = Math.max(0, Math.min(picked.length - 1, dragRef.current.from + Math.round(dy / ROW_H)));
    setDrag({ from: dragRef.current.from, to, dy });
  };
  const onHandleUp = () => {
    if (dragRef.current && drag && drag.from !== drag.to) {
      setPicked((p) => { const n = p.slice(); const [it] = n.splice(drag.from, 1); n.splice(drag.to, 0, it); return n; });
      if (navigator.vibrate) navigator.vibrate(8);
    }
    dragRef.current = null; setDrag(null);
  };
  const offsetFor = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -ROW_H;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return ROW_H;
    return 0;
  };

  const save = async () => {
    if (picked.length === 0) return;
    setBusy(true); setError(null);
    try {
      await apiPost("/api/programs/update", {
        program_id: programId, name, sessions_per_week: perWeek,
        exercises: picked.map((p) => (isCardio(p) ? { exercise_id: p.exercise_id } : { exercise_id: p.exercise_id, sets: p.sets, reps: p.reps })),
      });
      router.push("/train");
    } catch { setError("Couldn't save. Check your connection and token."); setBusy(false); }
  };

  if (!ready) return <div className="card-lift h-40 animate-pulse" />;

  return (
    <div className="space-y-5 pb-4">
      <header className="flex items-center justify-between gap-3 rise">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Edit program</p>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Program name" className="t-title bg-transparent outline-none w-full mt-1 border-b border-transparent focus:border-line" />
        </div>
        <button onClick={() => router.push("/train")} className="btn btn-ghost h-10 px-4 text-sm shrink-0">Cancel</button>
      </header>

      <div className="flex items-center justify-between rise">
        <span className="text-[15px] font-medium">Sessions per week</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPerWeek((v) => Math.max(1, v - 1))} className="iconbtn text-xl">−</button>
          <span className="t-num text-xl w-6 text-center">{perWeek}</span>
          <button onClick={() => setPerWeek((v) => Math.min(7, v + 1))} className="iconbtn text-xl">+</button>
        </div>
      </div>

      <section className="rise">
        <div className="flex items-baseline justify-between mb-1">
          <p className="eyebrow">Exercises · {picked.length}</p>
          <p className="t-sec">Hold ≡ to reorder</p>
        </div>
        {picked.length === 0 && <Empty line="No exercises yet." action="Add exercises" onAction={() => setAdding(true)} compact />}
        <div style={{ touchAction: drag ? "none" : "pan-y" }}>
          {picked.map((p, i) => (
            <div key={p.exercise_id} className={`flex items-center gap-2.5 border-b border-line ${drag?.from === i ? "bg-panel2 rounded-xl relative z-10 shadow-lg" : ""}`}
              style={{ height: ROW_H, transform: `translateY(${offsetFor(i)}px)`, transition: drag && drag.from !== i ? "transform .15s" : "none" }}>
              <button aria-label="drag to reorder" onPointerDown={onHandleDown(i)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                className="w-8 h-full text-dim text-lg shrink-0 cursor-grab select-none" style={{ touchAction: "none" }}>≡</button>
              <ExerciseAnimation frames={p.image_urls ?? []} alt={p.name} className="w-10 h-10 rounded-lg shrink-0 border border-line" intervalMs={1400} />
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-medium truncate">{p.name}</span>
                <span className="flex items-center gap-2 mt-1">
                  <span className="t-sec truncate"><span className="capitalize">{p.equipment}</span>{isCardio(p) ? " · cardio, by time" : ""}</span>
                  {!isCardio(p) && (
                    <span className="flex items-center gap-1 shrink-0 font-mono text-sm tnum ml-auto">
                      <Mini value={p.sets ?? 3} onDown={() => tweak(p.exercise_id, "sets", -1)} onUp={() => tweak(p.exercise_id, "sets", 1)} />
                      <span className="text-dim">×</span>
                      <Mini value={p.reps ?? 8} onDown={() => tweak(p.exercise_id, "reps", -1)} onUp={() => tweak(p.exercise_id, "reps", 1)} />
                    </span>
                  )}
                </span>
              </span>
              <button onClick={() => remove(p.exercise_id)} aria-label="remove" className="text-dim active:text-alert w-7 text-lg leading-none shrink-0">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setAdding(true)} className="btn btn-ghost w-full h-12 mt-3">+ Add exercises</button>
      </section>

      {error && <p className="text-alert text-sm px-1">{error}</p>}

      <div className="sticky z-20" style={{ bottom: "calc(70px + env(safe-area-inset-bottom))" }}>
        <button onClick={save} disabled={busy || picked.length === 0} className="btn btn-primary w-full h-14 text-base shadow-lg">
          {busy ? "Saving…" : picked.length === 0 ? "Add at least one exercise" : `Save program · ${picked.length}`}
        </button>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add exercises" action={<button onClick={() => setAdding(false)} className="btn btn-primary h-10 px-4 text-sm">Done</button>}>
        <CatalogSearch onPick={add} pickedIds={picked.map((p) => p.exercise_id)} />
      </Sheet>
    </div>
  );
}

function Mini({ value, onDown, onUp }: { value: number; onDown: () => void; onUp: () => void }) {
  return (
    <span className="flex items-center rounded-lg border border-line bg-panel2">
      <button onClick={onDown} aria-label="decrease" className="w-7 h-7 text-dim active:text-bone">−</button>
      <span className="w-5 text-center text-xs">{value}</span>
      <button onClick={onUp} aria-label="increase" className="w-7 h-7 text-dim active:text-bone">+</button>
    </span>
  );
}
