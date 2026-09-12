"use client";
/* The workout player — the gym-floor screen. One exercise at a time: a big picture, the target,
   two big numbers, one button. Rest timer takes the screen after each strength set. Swipe/tap
   to the next lift. Finish shows a summary. State model is unchanged from the old list screen
   (localStorage `active_session_v2` + the offline queue), so Home, History and the coach see
   exactly the same data. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, configured, exerciseStats, type ProgramSlot } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import ExerciseAnimation from "./ExerciseAnimation";
import ExerciseDetail from "./ExerciseDetail";
import NumField from "./NumField";
import RestTimer from "./RestTimer";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";

type LoggedSet = {
  id: string; slotId: string; exerciseId: string;
  reps?: number; weightKg?: number; durationS?: number; distanceM?: number; inclinePct?: number;
  rpe?: number | null; setType?: string | null; prNote?: string | null;
};
type LogPayload = Omit<LoggedSet, "id" | "slotId" | "exerciseId">;
type Session = { id: string; startedAt: string; logged: LoggedSet[]; adhoc: ProgramSlot[]; idx?: number };

const SKEY = "active_session_v2";
const REST_SECONDS = 90;
const isCardio = (s: ProgramSlot) => s.category === "cardio";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SKEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return { ...s, logged: s.logged ?? [], adhoc: s.adhoc ?? [] };
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  if (s === null) localStorage.removeItem(SKEY);
  else localStorage.setItem(SKEY, JSON.stringify(s));
}
function adhocSlot(r: CatalogRow): ProgramSlot {
  return {
    program_exercise_id: `adhoc:${r.exercise_id}`, exercise_id: r.exercise_id, name: r.name,
    equipment: r.equipment, category: r.category ?? null, sets: null, reps: null, load_kg: null,
    suggested_kg: null, suggested_reason: null, image_urls: r.image_urls ?? [], cues: [], position: 999,
  };
}
function fmtDuration(startedAt: string) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
const haptic = (ms = 12) => navigator.vibrate && navigator.vibrate(ms);

export default function WorkoutPlayer() {
  const router = useRouter();
  const [slots, setSlots] = useState<ProgramSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [resting, setResting] = useState<{ exercise: string; nextSet: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [summary, setSummary] = useState<Session | null>(null);
  const [detail, setDetail] = useState<ProgramSlot | null>(null);

  useEffect(() => {
    setSession(loadSession());
    setHydrated(true);
    if (!configured()) return setError("not_configured");
    apiGet<{ slots: ProgramSlot[] }>("/api/program/today")
      .then((d) => setSlots(d.slots))
      .catch(() => setError("offline"));
  }, []);

  const persist = useCallback((next: Session | null) => {
    setSession(next);
    saveSession(next);
  }, []);

  const start = useCallback(() => {
    const s: Session = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), logged: [], adhoc: [], idx: 0 };
    persist(s);
    void enqueue("/api/sessions/start", { session_id: s.id, started_at: s.startedAt });
    haptic();
  }, [persist]);

  const all = useMemo(() => [...(slots ?? []), ...(session?.adhoc ?? [])], [slots, session?.adhoc]);
  const idx = Math.min(session?.idx ?? 0, Math.max(0, all.length - 1));
  const current = all[idx];
  const setIdx = useCallback((i: number) => {
    if (!session) return;
    persist({ ...session, idx: Math.max(0, Math.min(all.length - 1, i)) });
  }, [session, all.length, persist]);

  const logSet = useCallback((slot: ProgramSlot, p: LogPayload) => {
    if (!session) return;
    const entry: LoggedSet = { id: crypto.randomUUID(), slotId: slot.program_exercise_id, exerciseId: slot.exercise_id, ...p };
    persist({ ...session, logged: [...session.logged, entry] });
    void enqueue("/api/sets/sync", {
      session_id: session.id,
      sets: [{
        id: entry.id, exercise_id: slot.exercise_id,
        reps: p.reps ?? null, weight_kg: p.weightKg ?? null, rpe: p.rpe ?? null, set_type: p.setType ?? null,
        duration_s: p.durationS ?? null, distance_m: p.distanceM ?? null, incline_pct: p.inclinePct ?? null,
        logged_at: new Date().toISOString(),
      }],
    });
    haptic(18);
    if (!isCardio(slot)) {
      const done = session.logged.filter((l) => l.slotId === slot.program_exercise_id).length + 1;
      const planned = slot.sets ?? 0;
      setResting({ exercise: slot.name, nextSet: planned && done >= planned ? "exercise complete" : `set ${done + 1}${planned ? ` of ${planned}` : ""}` });
    }
  }, [session, persist]);

  const removeSet = useCallback((set: LoggedSet) => {
    if (!session) return;
    persist({ ...session, logged: session.logged.filter((l) => l.id !== set.id) });
    void enqueue("/api/sets/delete", { session_id: session.id, set_id: set.id });
  }, [session, persist]);

  const editSet = useCallback((set: LoggedSet, p: LogPayload) => {
    if (!session) return;
    persist({ ...session, logged: session.logged.map((l) => (l.id === set.id ? { ...l, ...p } : l)) });
    void enqueue("/api/sets/update", {
      session_id: session.id, set_id: set.id,
      reps: p.reps ?? null, weight_kg: p.weightKg ?? null, duration_s: p.durationS ?? null, distance_m: p.distanceM ?? null,
    });
  }, [session, persist]);

  const addAdhoc = useCallback((r: CatalogRow) => {
    if (!session) return;
    if (all.some((s) => s.exercise_id === r.exercise_id)) return;
    const next = { ...session, adhoc: [...session.adhoc, adhocSlot(r)] };
    persist({ ...next, idx: all.length });
    setShowAdd(false);
  }, [session, all, persist]);

  const finish = useCallback(() => {
    if (!session) return;
    void enqueue("/api/sessions/complete", { session_id: session.id, completed_at: new Date().toISOString() });
    setSummary(session);
    setShowFinish(false);
    persist(null);
    haptic(30);
  }, [session, persist]);

  const discard = useCallback(() => {
    if (!session) return;
    persist(null);
    setShowFinish(false);
    router.push("/");
  }, [session, persist, router]);

  /* ---- states ---------------------------------------------------------------------------- */
  if (error === "not_configured")
    return <Shell><div className="card p-5"><Empty line="Paste your access token once and everything goes live." action="Open Setup" href="/settings" compact /></div></Shell>;

  if (summary) return <Summary session={summary} slots={all.length ? all : summary.adhoc} />;

  if (!hydrated || (!slots && !error))
    return <Shell><div className="card-lift h-64 animate-pulse" /></Shell>;

  // not started: the plan, one button
  if (!session) {
    const list = slots ?? [];
    return (
      <Shell>
        <section className="card-lift p-5 rise">
          <p className="eyebrow">Today</p>
          <p className="t-hero mt-2">{list.length}<span className="text-dim text-2xl font-display font-semibold ml-1.5">exercises</span></p>
          <button onClick={start} className="btn btn-primary w-full h-14 mt-5 text-base">Start workout</button>
        </section>
        {list.length === 0 && (
          <Empty line="Nothing scheduled today. Start anyway and add exercises as you go." />
        )}
        <div>
          {list.map((s) => (
            <div key={s.program_exercise_id} className="row">
              <ExerciseAnimation frames={s.image_urls} alt={s.name} className="w-10 h-10 rounded-lg border border-line shrink-0" intervalMs={1400} />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[15px] font-medium">{s.name}</span>
                <span className="block t-sec tnum">{isCardio(s) ? "cardio" : s.sets ? `${s.sets} × ${s.reps}` : "open"}</span>
              </span>
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  const doneSets = session.logged.length;
  const plannedSets = all.reduce((t, s) => t + (isCardio(s) ? 1 : s.sets ?? 0), 0);
  const loggedFor = (s: ProgramSlot) => session.logged.filter((l) => l.slotId === s.program_exercise_id);
  const exerciseDone = (s: ProgramSlot) => !isCardio(s) && (s.sets ?? 0) > 0 && loggedFor(s).length >= (s.sets ?? 0);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 rise">
        <button onClick={() => setShowAll(true)} className="min-w-0 text-left">
          <p className="eyebrow">{current?.program_name || "Workout"} · {all.length ? `${idx + 1} of ${all.length}` : "open"}</p>
          <p className="t-sec mt-1 tnum">{fmtDuration(session.startedAt)} · {doneSets} sets logged · <span className="text-volt">all exercises</span></p>
        </button>
        <button onClick={() => setShowFinish(true)} className="btn btn-ghost h-10 px-4 text-sm shrink-0 border-volt/40 text-volt">Finish</button>
      </header>

      {plannedSets > 0 && (
        <div className="pills rise" aria-label={`${doneSets} of ${plannedSets} sets`}>
          {Array.from({ length: Math.min(plannedSets, 30) }, (_, i) => (
            <i key={i} data-on={i < Math.round((Math.min(doneSets, plannedSets) / plannedSets) * Math.min(plannedSets, 30))} />
          ))}
        </div>
      )}

      {current ? (
        <ExerciseStage
          key={current.program_exercise_id}
          slot={current}
          loggedSets={loggedFor(current)}
          done={exerciseDone(current)}
          onLog={logSet}
          onRemove={removeSet}
          onEdit={editSet}
          onDetail={() => setDetail(current)}
          onNext={idx < all.length - 1 ? () => setIdx(idx + 1) : undefined}
        />
      ) : (
        <div className="card p-5 rise">
          <Empty line="No exercises yet. Add one to start logging." action="Add exercise" onAction={() => setShowAdd(true)} compact />
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center rise">
        <button onClick={() => setIdx(idx - 1)} disabled={idx === 0} className="btn btn-ghost h-12 text-sm justify-start px-4 min-w-0">
          <span className="text-dim">‹</span><span className="truncate">{all[idx - 1]?.name ?? "Start"}</span>
        </button>
        <button onClick={() => setShowAdd(true)} aria-label="Add exercise" className="iconbtn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button onClick={() => setIdx(idx + 1)} disabled={idx >= all.length - 1} className="btn btn-ghost h-12 text-sm justify-end px-4 min-w-0">
          <span className="truncate">{all[idx + 1]?.name ?? "End"}</span><span className="text-dim">›</span>
        </button>
      </div>

      {/* all exercises */}
      <Sheet open={showAll} onClose={() => setShowAll(false)} eyebrow={`${doneSets} sets logged`} title="This workout">
        <div>
          {all.map((s, i) => {
            const n = loggedFor(s).length;
            return (
              <button key={s.program_exercise_id} onClick={() => { setIdx(i); setShowAll(false); }} className={`row ${i === idx ? "text-volt" : ""}`}>
                <span className="font-mono text-xs text-dim w-5 tnum">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-[15px] font-medium">{s.name}</span>
                <span className={`font-mono text-xs tnum ${exerciseDone(s) ? "text-good" : "text-dim"}`}>
                  {isCardio(s) ? (n ? "logged" : "") : `${n}/${s.sets ?? (n || "–")}`}
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={() => { setShowAll(false); setShowAdd(true); }} className="btn btn-ghost w-full h-12 mt-4">+ Add an exercise</button>
      </Sheet>

      {/* add exercise */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Add exercise">
        <CatalogSearch onPick={addAdhoc} pickedIds={all.map((s) => s.exercise_id)} />
      </Sheet>

      {/* finish */}
      <Sheet open={showFinish} onClose={() => setShowFinish(false)} eyebrow={fmtDuration(session.startedAt)} title="Finish workout?">
        <p className="t-sec tnum">{doneSets} set{doneSets === 1 ? "" : "s"} across {new Set(session.logged.map((l) => l.slotId)).size} exercise{new Set(session.logged.map((l) => l.slotId)).size === 1 ? "" : "s"}.</p>
        <button onClick={finish} className="btn btn-primary w-full h-14 mt-5 text-base">Finish workout</button>
        {doneSets === 0 ? (
          <button onClick={discard} className="btn btn-quiet w-full h-10 mt-2 text-sm">Discard empty session</button>
        ) : (
          <button onClick={() => setShowFinish(false)} className="btn btn-quiet w-full h-10 mt-2 text-sm">Keep going</button>
        )}
      </Sheet>

      {detail && <ExerciseDetail exerciseId={detail.exercise_id} name={detail.name} frames={detail.image_urls} onClose={() => setDetail(null)} />}

      {resting && (
        <RestTimer seconds={REST_SECONDS} exercise={resting.exercise} nextSet={resting.nextSet} onDone={() => setResting(null)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between rise">
        <div>
          <p className="eyebrow">Workout</p>
          <h1 className="t-title mt-1">Today</h1>
        </div>
        <Link href="/" className="btn btn-ghost h-10 px-4 text-sm">Home</Link>
      </header>
      {children}
    </div>
  );
}

function ExerciseStage({
  slot, loggedSets, done, onLog, onRemove, onEdit, onDetail, onNext,
}: {
  slot: ProgramSlot; loggedSets: LoggedSet[]; done: boolean;
  onLog: (s: ProgramSlot, p: LogPayload) => void; onRemove: (s: LoggedSet) => void; onEdit: (s: LoggedSet, p: LogPayload) => void;
  onDetail: () => void; onNext?: () => void;
}) {
  const cardio = isCardio(slot);
  const last = loggedSets[loggedSets.length - 1];
  const [reps, setReps] = useState(last?.reps ?? slot.reps ?? 8);
  const [weight, setWeight] = useState(last?.weightKg ?? slot.suggested_kg ?? slot.load_kg ?? 20);
  const [durationMin, setDurationMin] = useState(last?.durationS ? Math.round(last.durationS / 60) : 20);
  const [distanceKm, setDistanceKm] = useState(last?.distanceM ? +(last.distanceM / 1000).toFixed(1) : 0);
  const [inclinePct, setInclinePct] = useState(last?.inclinePct ?? 0);
  const [rpe, setRpe] = useState<number | null>(null);
  const [setType, setSetType] = useState("normal");
  const [showTag, setShowTag] = useState(false);
  const [showCues, setShowCues] = useState(false);
  const [bestE1rm, setBestE1rm] = useState<number | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoggedSet | null>(null);
  const [eA, setEA] = useState(0);
  const [eB, setEB] = useState(0);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cardio) return;
    let live = true;
    exerciseStats(slot.exercise_id).then((s) => live && setBestE1rm(s.best_e1rm)).catch(() => {});
    return () => { live = false; };
  }, [slot.exercise_id, cardio]);

  const planned = slot.sets ?? 0;
  const n = loggedSets.length;

  const log = () => {
    if (cardio) {
      onLog(slot, { durationS: Math.round(durationMin * 60), distanceM: Math.round(distanceKm * 1000), inclinePct: inclinePct || undefined });
      return;
    }
    let prNote: string | null = null;
    if (weight > 0 && reps > 0) {
      const e1rm = weight * (1 + reps / 30);
      if (bestE1rm == null || e1rm > bestE1rm + 0.05) {
        setBestE1rm(e1rm);
        prNote = `New best · est. 1RM ${Math.round(e1rm)} kg`;
        setPr(prNote);
        setTimeout(() => setPr(null), 4500);
      }
    }
    onLog(slot, { reps, weightKg: weight, rpe, setType: setType !== "normal" ? setType : null, prNote });
    flashRef.current?.classList.remove("log-flash");
    void flashRef.current?.offsetWidth;
    flashRef.current?.classList.add("log-flash");
  };

  const startEdit = (s: LoggedSet) => {
    setEditing(s);
    if (cardio) { setEA(Math.round((s.durationS ?? 0) / 60)); setEB(+((s.distanceM ?? 0) / 1000).toFixed(1)); }
    else { setEA(s.weightKg ?? 0); setEB(s.reps ?? 0); }
  };
  const saveEdit = () => {
    if (!editing) return;
    if (cardio) onEdit(editing, { durationS: Math.round(eA * 60), distanceM: Math.round(eB * 1000) });
    else onEdit(editing, { weightKg: eA, reps: eB });
    setEditing(null);
  };

  return (
    <section ref={flashRef} className="card-lift overflow-hidden rise">
      <button onClick={onDetail} className="block w-full text-left">
        <ExerciseAnimation frames={slot.image_urls} alt={slot.name} className="w-full aspect-[16/10]" intervalMs={1400} />
      </button>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <button onClick={onDetail} className="text-left min-w-0">
            <h2 className="t-title">{slot.name}</h2>
            <p className="t-sec mt-1.5 tnum">
              {cardio ? "Cardio" : planned ? `Target ${slot.sets} × ${slot.reps}` : "Open set"}
              {!cardio && bestE1rm != null && ` · best e1RM ${Math.round(bestE1rm)} kg`}
              {slot.suggested_kg && n === 0 ? ` · try ${slot.suggested_kg} kg` : ""}
            </p>
          </button>
          {pr ? <span className="chip chip-on px-2.5 py-1 text-[11px] font-semibold shrink-0 pop">PR</span>
            : done ? <span className="chip px-2.5 py-1 text-[11px] font-semibold text-good border-good/40 shrink-0">Done</span> : null}
        </div>

        {!cardio && (planned > 0 || n > 0) && (
          <div className="pills mt-3" style={{ maxWidth: 200 }}>
            {Array.from({ length: Math.max(planned, n) }, (_, i) => <i key={i} data-on={i < n} />)}
          </div>
        )}

        {n > 0 && (
          <ul className="mt-4 -mx-1">
            {loggedSets.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 px-1 py-1.5 text-[15px]">
                <span className="font-mono text-xs text-dim w-4 tnum">{i + 1}</span>
                <button onClick={() => startEdit(s)} className="tnum text-left flex-1 active:text-volt">
                  {cardio
                    ? `${Math.round((s.durationS ?? 0) / 60)} min${s.distanceM ? ` · ${(s.distanceM / 1000).toFixed(1)} km` : ""}${s.inclinePct ? ` · ${s.inclinePct}%` : ""}`
                    : <><b className="font-semibold">{s.weightKg} kg</b> <span className="text-dim">×</span> {s.reps}</>}
                  {s.rpe != null && <span className="text-dim text-xs ml-2">RPE {s.rpe}</span>}
                  {s.setType && s.setType !== "normal" && <span className="text-dim text-[10px] uppercase font-mono ml-2">{s.setType}</span>}
                  {s.prNote && <span className="text-volt text-xs ml-2">PR</span>}
                </button>
                <button onClick={() => onRemove(s)} aria-label="remove set" className="text-dim active:text-alert px-1 text-lg leading-none">×</button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          {cardio ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <NumField value={durationMin} onChange={setDurationMin} step={1} min={1} max={600} unit="min" />
                <NumField value={distanceKm} onChange={setDistanceKm} step={0.1} min={0} max={300} decimals={1} unit="km" />
              </div>
              <NumField label="Incline" value={inclinePct} onChange={setInclinePct} step={0.5} min={0} max={40} decimals={1} unit="%" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <NumField value={weight} onChange={setWeight} step={2.5} min={0} max={1000} decimals={1} unit="kg" />
              <NumField value={reps} onChange={setReps} step={1} min={1} max={100} unit="reps" />
            </div>
          )}
          {done && onNext ? (
            <div className="grid grid-cols-[1fr_auto] gap-2.5 mt-3">
              <button onClick={onNext} className="btn btn-primary h-14 text-base">Next exercise ›</button>
              <button onClick={log} className="btn btn-ghost h-14 px-4 text-sm">+ Set</button>
            </div>
          ) : (
            <button onClick={log} className="btn btn-primary w-full h-14 mt-3 text-base">
              {cardio ? (n ? "Log again" : "Log") : `Log set ${n + 1}${planned ? ` of ${planned}` : ""}`}
            </button>
          )}
          {pr && <p className="text-volt text-sm font-semibold mt-2.5 pop">🎉 {pr}</p>}
          {!cardio && n === 0 && slot.suggested_reason && <p className="t-sec mt-2">{slot.suggested_reason}</p>}
        </div>

        <div className="flex items-center gap-4 mt-3">
          {!cardio && (
            <button onClick={() => setShowTag((v) => !v)} className="text-xs font-mono text-dim active:text-bone">
              {setType !== "normal" || rpe != null ? `${setType !== "normal" ? setType : ""}${setType !== "normal" && rpe != null ? " · " : ""}${rpe != null ? `RPE ${rpe}` : ""}` : "RPE / set type"}
            </button>
          )}
          {slot.cues.length > 0 && (
            <button onClick={() => setShowCues((v) => !v)} className="text-xs font-mono text-dim active:text-bone">{showCues ? "Hide cues" : "Form cues"}</button>
          )}
        </div>
        {showTag && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {["normal", "warmup", "drop", "failure"].map((t) => (
              <button key={t} onClick={() => setSetType(t)} className={`chip px-2.5 py-1 text-[11px] capitalize ${setType === t ? "chip-on" : "text-dim"}`}>{t}</button>
            ))}
            <span className="w-px self-stretch bg-line mx-1" />
            {[6, 7, 8, 9, 10].map((v) => (
              <button key={v} onClick={() => setRpe(rpe === v ? null : v)} className={`chip px-2.5 py-1 text-[11px] tnum ${rpe === v ? "chip-on" : "text-dim"}`}>RPE {v}</button>
            ))}
          </div>
        )}
        {showCues && (
          <ol className="mt-3 space-y-1.5 text-sm text-bone/85 list-decimal list-inside marker:text-dim">
            {slot.cues.slice(0, 4).map((c, i) => <li key={i} className="leading-snug">{c}</li>)}
          </ol>
        )}
      </div>

      <Sheet open={editing != null} onClose={() => setEditing(null)} title="Edit set">
        <div className="grid grid-cols-2 gap-2.5">
          {cardio ? (
            <>
              <NumField value={eA} onChange={setEA} step={1} min={1} max={600} unit="min" />
              <NumField value={eB} onChange={setEB} step={0.1} min={0} max={300} decimals={1} unit="km" />
            </>
          ) : (
            <>
              <NumField value={eA} onChange={setEA} step={2.5} min={0} max={1000} decimals={1} unit="kg" />
              <NumField value={eB} onChange={setEB} step={1} min={1} max={100} unit="reps" />
            </>
          )}
        </div>
        <button onClick={saveEdit} className="btn btn-primary w-full h-14 mt-5 text-base">Save</button>
      </Sheet>
    </section>
  );
}

function Summary({ session, slots }: { session: Session; slots: ProgramSlot[] }) {
  const byEx = new Map<string, LoggedSet[]>();
  for (const l of session.logged) byEx.set(l.slotId, [...(byEx.get(l.slotId) ?? []), l]);
  const prs = session.logged.filter((l) => l.prNote);
  const volume = session.logged.reduce((t, l) => t + (l.weightKg ?? 0) * (l.reps ?? 0), 0);
  const name = (id: string) => slots.find((s) => s.program_exercise_id === id)?.name ?? id.replace("adhoc:", "");
  return (
    <div className="space-y-6">
      <header className="rise">
        <p className="eyebrow">Workout complete</p>
        <h1 className="t-title mt-1.5">Nice work.</h1>
      </header>
      <section className="card-lift p-5 rise">
        <div className="grid grid-cols-3 gap-3">
          <div><p className="t-num text-3xl">{session.logged.length}</p><p className="t-sec">sets</p></div>
          <div><p className="t-num text-3xl">{byEx.size}</p><p className="t-sec">exercises</p></div>
          <div><p className="t-num text-3xl">{fmtDuration(session.startedAt).replace(" min", "")}</p><p className="t-sec">minutes</p></div>
        </div>
        {volume > 0 && <p className="t-sec mt-4 tnum">{Math.round(volume).toLocaleString()} kg moved in total.</p>}
        {prs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {prs.map((p) => <span key={p.id} className="chip chip-on px-2.5 py-1 text-[11px] font-semibold">{name(p.slotId)} · PR</span>)}
          </div>
        )}
      </section>
      <div className="rise">
        {[...byEx.entries()].map(([id, sets]) => (
          <div key={id} className="row">
            <span className="flex-1 min-w-0 truncate text-[15px] font-medium">{name(id)}</span>
            <span className="t-sec tnum">{sets.length} set{sets.length === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
      <Link href="/" className="btn btn-primary w-full h-14 text-base rise">Back home</Link>
    </div>
  );
}
