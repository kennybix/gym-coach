"use client";
/* The gym-floor screen. One-handed, glanceable, dim rooms, sweaty thumbs.
 * Now supports: editing the program, adding exercises ad-hoc for today, logging
 * multiple sets per exercise, and removing a mis-logged set. Every write goes through
 * the offline queue (lib/queue.ts); set ids are client-generated so deletes are safe. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, configured, type ProgramSlot } from "@/lib/api";
import { enqueue, installQueueAutoFlush, subscribeQueue } from "@/lib/queue";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import InsightCard from "./InsightCard";
import NumField from "./NumField";
import RestTimer from "./RestTimer";

type LoggedSet = { id: string; slotId: string; exerciseId: string; reps: number; weightKg: number };
type Session = { id: string; startedAt: string; logged: LoggedSet[]; adhoc: ProgramSlot[] };

const SKEY = "active_session_v2";
const REST_SECONDS = 90;

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
    program_exercise_id: `adhoc:${r.exercise_id}`,
    exercise_id: r.exercise_id,
    name: r.name,
    equipment: r.equipment,
    sets: null,
    reps: null,
    load_kg: null,
    image_urls: [],
    cues: [],
    position: 999,
  };
}

export default function SessionLogger() {
  const [slots, setSlots] = useState<ProgramSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [resting, setResting] = useState<{ exercise: string; nextSet: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setOnline(navigator.onLine);
    const un1 = subscribeQueue(setQueued);
    const un2 = installQueueAutoFlush();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      un1();
      un2();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!configured()) {
      setError("not_configured");
      return;
    }
    apiGet<{ slots: ProgramSlot[] }>("/api/program/today")
      .then((d) => setSlots(d.slots))
      .catch(() => setError("offline_no_cache"));
  }, []);

  const persist = useCallback((next: Session | null) => {
    setSession(next);
    saveSession(next);
  }, []);

  const start = useCallback(() => {
    const s: Session = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), logged: [], adhoc: [] };
    persist(s);
    void enqueue("/api/sessions/start", { session_id: s.id, started_at: s.startedAt });
  }, [persist]);

  const finish = useCallback(() => {
    if (!session) return;
    void enqueue("/api/sessions/complete", { session_id: session.id, completed_at: new Date().toISOString() });
    persist(null);
  }, [session, persist]);

  const addAdhoc = useCallback(
    (r: CatalogRow) => {
      if (!session) return;
      if (session.adhoc.some((a) => a.exercise_id === r.exercise_id)) return;
      if (slots?.some((s) => s.exercise_id === r.exercise_id)) return;
      persist({ ...session, adhoc: [...session.adhoc, adhocSlot(r)] });
    },
    [session, slots, persist]
  );

  const logSet = useCallback(
    (slot: ProgramSlot, reps: number, weightKg: number) => {
      if (!session) return;
      const setId = crypto.randomUUID();
      const entry: LoggedSet = { id: setId, slotId: slot.program_exercise_id, exerciseId: slot.exercise_id, reps, weightKg };
      persist({ ...session, logged: [...session.logged, entry] });
      void enqueue("/api/sets/sync", {
        session_id: session.id,
        sets: [{ id: setId, exercise_id: slot.exercise_id, reps, weight_kg: weightKg, logged_at: new Date().toISOString() }],
      });
      setFlash(slot.program_exercise_id);
      setTimeout(() => setFlash(null), 750);
      const done = session.logged.filter((l) => l.slotId === slot.program_exercise_id).length + 1;
      const planned = slot.sets ?? 0;
      setResting({
        exercise: slot.name,
        nextSet: planned && done >= planned ? "exercise complete" : `set ${done + 1}${planned ? ` of ${planned}` : ""}`,
      });
    },
    [session, persist]
  );

  const removeSet = useCallback(
    (set: LoggedSet) => {
      if (!session) return;
      persist({ ...session, logged: session.logged.filter((l) => l.id !== set.id) });
      void enqueue("/api/sets/delete", { session_id: session.id, set_id: set.id });
    },
    [session, persist]
  );

  const editSet = useCallback(
    (set: LoggedSet, reps: number, weightKg: number) => {
      if (!session) return;
      persist({
        ...session,
        logged: session.logged.map((l) => (l.id === set.id ? { ...l, reps, weightKg } : l)),
      });
      void enqueue("/api/sets/update", { session_id: session.id, set_id: set.id, reps, weight_kg: weightKg });
    },
    [session, persist]
  );

  if (error === "not_configured")
    return (
      <Shell online queued={0}>
        <Panel>
          <p className="text-dim text-sm leading-relaxed">
            No API token set. Open <span className="text-volt font-semibold">Setup</span> and paste
            your server URL + token once — then this screen goes live.
          </p>
        </Panel>
      </Shell>
    );

  if (error)
    return (
      <Shell online={online} queued={queued}>
        <Panel>
          <p className="text-dim text-sm leading-relaxed">
            Can&apos;t reach the server and no cached program yet. Connect once and today&apos;s plan
            will be available offline afterward.
          </p>
        </Panel>
      </Shell>
    );

  if (!slots)
    return (
      <Shell online={online} queued={queued}>
        <div className="card p-5 h-28 animate-pulse" />
      </Shell>
    );

  const allSlots = [...slots, ...(session?.adhoc ?? [])];

  return (
    <div className="space-y-5">
      <Header online={online} queued={queued} />

      <InsightCard />

      {!session ? (
        <button onClick={start} className="btn btn-primary w-full h-16 text-base rise">
          Start session
        </button>
      ) : (
        <button onClick={finish} className="btn btn-ghost w-full h-[3.25rem] rise border-volt/40 text-volt">
          <span className="font-semibold">Finish workout</span>
          <span className="text-dim font-normal">· {session.logged.length} sets</span>
        </button>
      )}

      {allSlots.length === 0 ? (
        <Panel>
          <p className="text-dim text-sm leading-relaxed">
            No exercises yet. Build a program you&apos;ll follow, or start a session and add exercises
            on the fly.
          </p>
          <Link href="/program" className="btn btn-primary h-12 w-full mt-4">Build program</Link>
        </Panel>
      ) : (
        <div className="space-y-4">
          {allSlots.map((slot, i) => (
            <SlotCard
              key={slot.program_exercise_id}
              slot={slot}
              index={i}
              active={Boolean(session)}
              loggedSets={session ? session.logged.filter((l) => l.slotId === slot.program_exercise_id) : []}
              flash={flash === slot.program_exercise_id}
              onLog={logSet}
              onRemoveSet={removeSet}
              onEditSet={editSet}
            />
          ))}
        </div>
      )}

      {session && (
        <button onClick={() => setShowAdd(true)} className="btn btn-ghost w-full h-12 border-dashed">
          + Add exercise for today
        </button>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-end" onClick={() => setShowAdd(false)}>
          <div
            className="w-full max-w-md mx-auto card rounded-b-none p-5 max-h-[82dvh] overflow-auto scroll-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="eyebrow">Add exercise for today</p>
              <button onClick={() => setShowAdd(false)} className="btn btn-primary h-9 px-4 text-sm">Done</button>
            </div>
            <CatalogSearch
              onPick={addAdhoc}
              pickedIds={[...slots.map((s) => s.exercise_id), ...(session?.adhoc.map((a) => a.exercise_id) ?? [])]}
            />
          </div>
        </div>
      )}

      {resting && (
        <RestTimer
          seconds={REST_SECONDS}
          exercise={resting.exercise}
          nextSet={resting.nextSet}
          onDone={() => setResting(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------- pieces ---------------------------------- */

function Shell({ children, online, queued }: { children: React.ReactNode; online: boolean; queued: number }) {
  return (
    <div className="space-y-5">
      <Header online={online} queued={queued} />
      {children}
    </div>
  );
}

function Header({ online, queued }: { online: boolean; queued: number }) {
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });
  const date = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return (
    <header className="flex items-end justify-between rise">
      <div>
        <p className="eyebrow">{weekday} · {date}</p>
        <h1 className="font-display text-[28px] font-bold leading-none mt-1.5">Today</h1>
      </div>
      <div className="flex items-center gap-1.5">
        <Link href="/history" className="btn btn-ghost h-9 px-3 text-xs">History</Link>
        <Link href="/program" className="btn btn-ghost h-9 px-3 text-xs">Edit</Link>
        <StatusChip online={online} queued={queued} />
      </div>
    </header>
  );
}

function StatusChip({ online, queued }: { online: boolean; queued: number }) {
  const label = online ? (queued ? `Syncing ${queued}` : "Synced") : `Offline · ${queued}`;
  return (
    <span className={`chip inline-flex items-center gap-1.5 px-3 py-1.5 text-xs ${online ? "text-dim" : "border-alert/60 text-alert"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${online ? (queued ? "bg-volt" : "bg-emerald-400") : "bg-alert"}`} />
      {label}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="card p-5 rise">{children}</div>;
}

function SlotCard({
  slot,
  index,
  active,
  loggedSets,
  flash,
  onLog,
  onRemoveSet,
  onEditSet,
}: {
  slot: ProgramSlot;
  index: number;
  active: boolean;
  loggedSets: LoggedSet[];
  flash: boolean;
  onLog: (slot: ProgramSlot, reps: number, weightKg: number) => void;
  onRemoveSet: (set: LoggedSet) => void;
  onEditSet: (set: LoggedSet, reps: number, weightKg: number) => void;
}) {
  const [reps, setReps] = useState(slot.reps ?? 8);
  const [weight, setWeight] = useState(slot.load_kg ?? 20);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editReps, setEditReps] = useState(8);
  const [editWeight, setEditWeight] = useState(20);
  const [showCues, setShowCues] = useState(false);
  const planned = slot.sets ?? 0;
  const loggedCount = loggedSets.length;
  const done = planned > 0 && loggedCount >= planned;
  const img = slot.image_urls[0];

  // prefill from the last logged set so repeat-sets are one tap
  const last = loggedSets[loggedSets.length - 1];
  useEffect(() => {
    if (last) {
      setReps(last.reps);
      setWeight(last.weightKg);
    }
  }, [loggedSets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section
      className={`card overflow-hidden rise ${flash ? "log-flash" : ""}`}
      style={{ animationDelay: `${80 + index * 55}ms` }}
    >
      <div className="flex gap-3.5 p-4">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={slot.name} className="w-[72px] h-[72px] object-cover rounded-xl shrink-0 bg-panel2 border border-line" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display font-semibold leading-tight">{slot.name}</h2>
            {done && <span className="chip px-2 py-0.5 text-[10px] font-semibold text-volt border-volt/40 shrink-0">Done</span>}
          </div>
          <p className="text-dim text-xs mt-1 capitalize">
            {slot.equipment}
            {planned ? ` · target ${slot.sets} × ${slot.reps}` : " · added today"}
          </p>
          {(planned > 0 || loggedCount > 0) && (
            <div className="flex gap-1.5 mt-2.5">
              {Array.from({ length: Math.max(planned, loggedCount) }, (_, i) => (
                <span key={i} className={`h-1.5 w-6 rounded-full ${i < loggedCount ? "bg-volt" : "bg-line"}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* logged sets — tap to edit in place, × to remove */}
      {loggedSets.length > 0 && (
        <ul className="px-4 pb-1 space-y-1.5">
          {loggedSets.map((s, i) =>
            editingId === s.id ? (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-dim tnum w-5 text-xs shrink-0">{i + 1}</span>
                <div className="flex-1"><NumField value={editWeight} onChange={setEditWeight} step={2.5} min={0} max={1000} decimals={1} unit="kg" compact /></div>
                <div className="flex-1"><NumField value={editReps} onChange={setEditReps} step={1} min={1} max={100} unit="reps" compact /></div>
                <button
                  onClick={() => { onEditSet(s, editReps, editWeight); setEditingId(null); }}
                  className="btn btn-primary h-10 px-3 text-xs shrink-0"
                >
                  Save
                </button>
                <button onClick={() => setEditingId(null)} aria-label="cancel" className="text-dim px-1.5 text-base shrink-0">×</button>
              </li>
            ) : (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className="text-dim tnum w-5 text-xs">{i + 1}</span>
                <button
                  onClick={() => { setEditingId(s.id); setEditWeight(s.weightKg); setEditReps(s.reps); }}
                  className="tnum text-bone/90 text-left active:text-volt"
                >
                  {s.weightKg} kg <span className="text-dim">×</span> {s.reps}
                  <span className="text-dim text-xs ml-2">edit</span>
                </button>
                <button onClick={() => onRemoveSet(s)} aria-label="remove set" className="ml-auto text-dim hover:text-alert px-2 text-base leading-none">×</button>
              </li>
            )
          )}
        </ul>
      )}

      {slot.cues.length > 0 && (
        <button onClick={() => setShowCues((v) => !v)} className="w-full text-left px-4 py-2 text-xs font-medium text-dim active:text-volt">
          {showCues ? "Hide form cues" : "Form cues"}
        </button>
      )}
      {showCues && (
        <ol className="px-4 pb-3 space-y-2 text-sm text-bone/85 list-decimal list-inside marker:text-dim">
          {slot.cues.slice(0, 4).map((c, i) => (
            <li key={i} className="leading-snug">{c}</li>
          ))}
        </ol>
      )}

      {active && (
        <div className="border-t border-line p-3 grid grid-cols-[1fr_1fr_auto] gap-2.5">
          <NumField value={weight} onChange={setWeight} step={2.5} min={0} max={1000} decimals={1} unit="kg" />
          <NumField value={reps} onChange={setReps} step={1} min={1} max={100} unit="reps" />
          <button onClick={() => onLog(slot, reps, weight)} className="btn btn-primary px-5">
            {loggedCount > 0 ? "+ Set" : "Log"}
          </button>
        </div>
      )}
    </section>
  );
}
