"use client";
/* Natural-language logging: describe (or dictate) what you did, the coach parses it into
   structured entries, you confirm/edit, and it's logged as a completed session — feeding
   history, PRs, e1RM and the coach. No need to hunt through the exercise picker. */
import { useState } from "react";
import { parseWorkout, type CatalogMatch, type ParsedEntry } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import ExerciseAnimation from "./ExerciseAnimation";
import NumField from "./NumField";

const EXAMPLES = [
  "Ran on the treadmill at speed 5 for 20 minutes",
  "3 sets of 10 dumbbell curls with 20 lb each, then 12 push-ups x3",
];

export default function DescribeWorkout({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<ParsedEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);

  const parse = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await parseWorkout(text);
      if ("unavailable" in r) setErr("The coach is off right now, so I can't read descriptions. Log manually, or try later.");
      else if (!r.entries.length) setErr("I couldn't find any exercises in that. Try naming each movement with its numbers, e.g. \"3 sets of 10 squats at 40 kg\".");
      else setEntries(r.entries);
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  const patch = (i: number, p: Partial<ParsedEntry>) =>
    setEntries((es) => es!.map((e, j) => (j === i ? { ...e, ...p } : e)));
  const remove = (i: number) => setEntries((es) => (es!.length <= 1 ? es : es!.filter((_, j) => j !== i)));

  const readyCount = entries?.filter((e) => e.exercise).length ?? 0;

  const logAll = () => {
    const sid = crypto.randomUUID();
    const at = new Date().toISOString();
    void enqueue("/api/sessions/start", { session_id: sid, started_at: at });
    const rows: Record<string, unknown>[] = [];
    for (const e of entries!.filter((x) => x.exercise)) {
      const exercise_id = e.exercise!.exercise_id;
      if (e.kind === "cardio") {
        rows.push({ id: crypto.randomUUID(), exercise_id, duration_s: e.duration_s ?? null, distance_m: e.distance_m ?? null, logged_at: at });
      } else {
        for (let k = 0; k < Math.max(1, e.sets ?? 1); k++) {
          rows.push({ id: crypto.randomUUID(), exercise_id, reps: e.reps ?? null, weight_kg: e.weight_kg ?? null, rpe: e.rpe ?? null, logged_at: at });
        }
      }
    }
    void enqueue("/api/sets/sync", { session_id: sid, sets: rows });
    void enqueue("/api/sessions/complete", { session_id: sid, completed_at: new Date().toISOString() });
    onLogged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[88dvh] overflow-auto scroll-soft"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">Describe your workout</p>
          <button onClick={onClose} className="text-dim px-1.5 text-xl leading-none">×</button>
        </div>

        {!entries ? (
          <>
            <p className="text-dim text-sm leading-relaxed mb-3">
              Type or <span className="text-bone/80">tap the mic on your keyboard</span> and say what you
              did — in plain words. I&apos;ll turn it into sets, reps, weight, time and distance for you to confirm.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="e.g. used two 20 lb dumbbells for alternate curls, 3 sets of 10. Then treadmill at speed 4 for 12 minutes."
              className="field w-full p-3.5 text-sm outline-none resize-none"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setText(ex)} className="chip px-2.5 py-1 text-[11px] text-dim text-left">
                  {ex}
                </button>
              ))}
            </div>
            {err && <p className="text-alert text-xs mt-3">{err}</p>}
            <button onClick={parse} disabled={!text.trim() || busy} className="btn btn-primary w-full h-12 mt-4">
              {busy ? "Reading…" : "Parse workout"}
            </button>
          </>
        ) : (
          <>
            <p className="text-dim text-xs mb-3">Check each one, fix anything, then log. Tap an exercise to change it.</p>
            <div className="space-y-3">
              {entries.map((e, i) => (
                <div key={i} className="field p-3 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <ExerciseAnimation frames={e.exercise?.image_urls ?? []} alt={e.exercise?.name ?? ""} className="w-10 h-10 rounded-lg shrink-0 border border-line" />
                    <div className="flex-1 min-w-0">
                      {e.custom ? (
                        <input
                          value={e.exercise?.name ?? ""}
                          onChange={(ev) => patch(i, { exercise: { exercise_id: ev.target.value, name: ev.target.value, equipment: "none", category: e.exercise?.category ?? null, image_urls: [] } })}
                          placeholder="Activity name"
                          className="field h-9 w-full px-2.5 text-sm font-medium outline-none"
                        />
                      ) : (
                        <button onClick={() => setPickFor(pickFor === i ? null : i)} className="w-full text-left active:text-volt">
                          <span className="block text-sm font-medium truncate">{e.exercise?.name ?? "Pick an exercise"}</span>
                        </button>
                      )}
                      <span className="block text-dim text-[11px] truncate mt-0.5">
                        {e.custom ? "activity" : e.kind}{e.confidence === "low" ? " · low confidence" : ""}{e.est_kcal ? ` · ~${e.est_kcal} kcal` : ""}{e.note ? ` · ${e.note}` : ""}
                      </span>
                    </div>
                    <button onClick={() => setPickFor(pickFor === i ? null : i)} className="text-dim text-[11px] shrink-0 active:text-volt">catalog</button>
                    <button onClick={() => remove(i)} aria-label="remove" className="text-dim hover:text-alert px-1.5 text-lg shrink-0">×</button>
                  </div>

                  {pickFor === i && (
                    <div className="space-y-2">
                      {e.candidates.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {e.candidates.map((c) => (
                            <button
                              key={c.exercise_id}
                              onClick={() => { patch(i, { exercise: c }); setPickFor(null); }}
                              className={`chip px-2.5 py-1 text-[11px] ${e.exercise?.exercise_id === c.exercise_id ? "border-volt text-volt bg-volt/10" : "text-dim"}`}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <CatalogSearch
                        onPick={(r: CatalogRow) => {
                          patch(i, { exercise: { exercise_id: r.exercise_id, name: r.name, equipment: r.equipment, category: r.category ?? null, image_urls: r.image_urls ?? [] } as CatalogMatch });
                          setPickFor(null);
                        }}
                        pickedIds={e.exercise ? [e.exercise.exercise_id] : []}
                      />
                    </div>
                  )}

                  {e.kind === "cardio" ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      <L label="Time (min)"><NumField value={Math.round((e.duration_s ?? 0) / 60)} onChange={(v) => patch(i, { duration_s: Math.round(v * 60) })} step={1} min={0} max={600} compact /></L>
                      <L label="Distance (km)"><NumField value={+(((e.distance_m ?? 0) / 1000).toFixed(1))} onChange={(v) => patch(i, { distance_m: Math.round(v * 1000) })} step={0.1} min={0} max={300} decimals={1} compact /></L>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <L label="Sets"><NumField value={e.sets ?? 1} onChange={(v) => patch(i, { sets: Math.max(1, Math.round(v)) })} step={1} min={1} max={20} compact /></L>
                      <L label="Reps"><NumField value={e.reps ?? 1} onChange={(v) => patch(i, { reps: Math.max(1, Math.round(v)) })} step={1} min={1} max={100} compact /></L>
                      <L label="kg"><NumField value={e.weight_kg ?? 0} onChange={(v) => patch(i, { weight_kg: v })} step={2.5} min={0} max={1000} decimals={1} compact /></L>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {entries.reduce((t, e) => t + (e.est_kcal ?? 0), 0) > 0 && (
              <p className="text-dim text-xs mt-3 text-center">
                Estimated energy: ~{entries.reduce((t, e) => t + (e.est_kcal ?? 0), 0)} kcal
                <span className="opacity-70"> · rough, from duration</span>
              </p>
            )}
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => { setEntries(null); setErr(null); }} className="btn btn-ghost h-12 px-4">Back</button>
              <button onClick={logAll} disabled={readyCount === 0} className="btn btn-primary flex-1 h-12">
                {readyCount === 0 ? "Pick an exercise" : `Log workout · ${readyCount}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* label above a (number-only) stepper, so the value isn't squeezed out in a tight grid cell */
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-dim text-[11px] mb-1 truncate">{label}</p>
      {children}
    </div>
  );
}
