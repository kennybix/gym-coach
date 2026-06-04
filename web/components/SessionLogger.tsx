"use client";
/* The gym-floor screen. Design constraints: one-handed, glanceable, dim rooms,
 * sweaty thumbs. Big targets, tabular numerals, zero ambiguity about what was
 * logged. Every write goes through the offline queue (see lib/queue.ts). */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, configured, type ProgramSlot } from "@/lib/api";
import { enqueue, installQueueAutoFlush, subscribeQueue } from "@/lib/queue";
import RestTimer from "./RestTimer";

type LoggedSet = { slotId: string; reps: number; weightKg: number };
type Session = { id: string; startedAt: string; logged: LoggedSet[] };

const SKEY = "active_session_v1";
const REST_SECONDS = 90;

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SKEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  if (s === null) localStorage.removeItem(SKEY);
  else localStorage.setItem(SKEY, JSON.stringify(s));
}

export default function SessionLogger() {
  const [slots, setSlots] = useState<ProgramSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [resting, setResting] = useState<{ exercise: string; nextSet: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // wire queue + connectivity indicators
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

  const start = useCallback(() => {
    const s: Session = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      logged: [],
    };
    setSession(s);
    saveSession(s);
    void enqueue("/api/sessions/start", { session_id: s.id, started_at: s.startedAt });
  }, []);

  const finish = useCallback(() => {
    if (!session) return;
    void enqueue("/api/sessions/complete", {
      session_id: session.id,
      completed_at: new Date().toISOString(),
    });
    setSession(null);
    saveSession(null);
  }, [session]);

  const logSet = useCallback(
    (slot: ProgramSlot, reps: number, weightKg: number) => {
      if (!session) return;
      const next: Session = {
        ...session,
        logged: [...session.logged, { slotId: slot.program_exercise_id, reps, weightKg }],
      };
      setSession(next);
      saveSession(next);
      void enqueue("/api/sets/sync", {
        session_id: session.id,
        sets: [
          {
            id: crypto.randomUUID(),
            exercise_id: slot.exercise_id,
            reps,
            weight_kg: weightKg,
            logged_at: new Date().toISOString(),
          },
        ],
      });
      setFlash(slot.program_exercise_id);
      setTimeout(() => setFlash(null), 750);
      const done = next.logged.filter((l) => l.slotId === slot.program_exercise_id).length;
      const planned = slot.sets ?? 0;
      setResting({
        exercise: slot.name,
        nextSet:
          planned && done >= planned ? "exercise complete" : `set ${done + 1} of ${planned || "?"}`,
      });
    },
    [session]
  );

  if (error === "not_configured")
    return (
      <Panel>
        <p className="text-dim text-sm leading-relaxed">
          No API token set. Open <span className="text-volt font-display">SET-UP</span> and paste
          your server URL + token once — then this screen goes live.
        </p>
      </Panel>
    );

  if (error)
    return (
      <Panel>
        <p className="text-dim text-sm">
          Can&apos;t reach the server and no cached program yet. Connect once and today&apos;s plan
          will be available offline afterward.
        </p>
      </Panel>
    );

  if (!slots) return <Panel><p className="text-dim text-sm tnum">loading…</p></Panel>;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between rise">
        <div>
          <p className="font-display text-[11px] tracking-[0.3em] text-dim">
            {new Date().toLocaleDateString(undefined, { weekday: "long" }).toUpperCase()}
          </p>
          <h1 className="font-display text-3xl font-semibold leading-none mt-1">TODAY</h1>
        </div>
        <StatusChip online={online} queued={queued} />
      </header>

      {!session ? (
        <button
          onClick={start}
          className="w-full h-16 bg-volt text-ink font-display font-semibold tracking-[0.2em] active:bg-voltdim rise"
        >
          START SESSION
        </button>
      ) : (
        <button
          onClick={finish}
          className="w-full h-12 border border-volt/60 text-volt font-display tracking-[0.2em] active:bg-volt/10"
        >
          FINISH · {session.logged.length} SETS
        </button>
      )}

      {slots.map((slot, i) => (
        <SlotCard
          key={slot.program_exercise_id}
          slot={slot}
          index={i}
          active={Boolean(session)}
          loggedCount={
            session ? session.logged.filter((l) => l.slotId === slot.program_exercise_id).length : 0
          }
          flash={flash === slot.program_exercise_id}
          onLog={logSet}
        />
      ))}

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

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="bg-panel border border-line rule-volt p-5">{children}</div>;
}

function StatusChip({ online, queued }: { online: boolean; queued: number }) {
  const label = online ? (queued ? `SYNCING ${queued}` : "SYNCED") : `OFFLINE · ${queued} QUEUED`;
  return (
    <span
      className={`font-display text-[10px] tracking-[0.18em] px-2.5 py-1.5 border ${
        online ? "border-line text-dim" : "border-alert/70 text-alert"
      }`}
    >
      {label}
    </span>
  );
}

function Stepper({
  value,
  step,
  min,
  unit,
  onChange,
}: {
  value: number;
  step: number;
  min: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center border border-line bg-panel2">
      <button
        className="w-12 h-14 text-2xl text-dim active:text-volt"
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(1)))}
      >
        −
      </button>
      <div className="flex-1 text-center">
        <span className="font-display tnum text-2xl font-semibold">{value}</span>
        <span className="text-dim text-xs ml-1">{unit}</span>
      </div>
      <button
        className="w-12 h-14 text-2xl text-dim active:text-volt"
        onClick={() => onChange(+(value + step).toFixed(1))}
      >
        +
      </button>
    </div>
  );
}

function SlotCard({
  slot,
  index,
  active,
  loggedCount,
  flash,
  onLog,
}: {
  slot: ProgramSlot;
  index: number;
  active: boolean;
  loggedCount: number;
  flash: boolean;
  onLog: (slot: ProgramSlot, reps: number, weightKg: number) => void;
}) {
  const [reps, setReps] = useState(slot.reps ?? 8);
  const [weight, setWeight] = useState(slot.load_kg ?? 20);
  const [showCues, setShowCues] = useState(false);
  const planned = slot.sets ?? 0;
  const done = planned > 0 && loggedCount >= planned;
  const img = slot.image_urls[0];

  const ticks = useMemo(
    () => Array.from({ length: Math.max(planned, loggedCount) }, (_, i) => i < loggedCount),
    [planned, loggedCount]
  );

  return (
    <section
      className={`bg-panel border border-line rule-volt rise ${flash ? "log-flash" : ""}`}
      style={{ animationDelay: `${80 + index * 60}ms` }}
    >
      <div className="flex gap-3 p-4">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={slot.name}
            className="w-20 h-20 object-cover border border-line shrink-0 bg-panel2"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display font-semibold leading-tight">{slot.name}</h2>
            {done && <span className="text-volt font-display text-xs tracking-widest">DONE</span>}
          </div>
          <p className="text-dim text-xs mt-1">
            {slot.equipment} · {slot.sets ?? "?"} × {slot.reps ?? "?"}
          </p>
          <div className="flex gap-1.5 mt-2">
            {ticks.map((t, i) => (
              <span key={i} className={`w-5 h-1.5 ${t ? "bg-volt" : "bg-line"}`} />
            ))}
          </div>
        </div>
      </div>

      {slot.cues.length > 0 && (
        <button
          onClick={() => setShowCues((v) => !v)}
          className="w-full text-left px-4 pb-3 text-[11px] font-display tracking-[0.2em] text-dim active:text-volt"
        >
          {showCues ? "HIDE FORM CUES −" : "FORM CUES +"}
        </button>
      )}
      {showCues && (
        <ol className="px-4 pb-4 space-y-2 text-sm text-bone/85 list-decimal list-inside">
          {slot.cues.slice(0, 4).map((c, i) => (
            <li key={i} className="leading-snug">{c}</li>
          ))}
        </ol>
      )}

      {active && !done && (
        <div className="border-t border-line p-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Stepper value={weight} step={2.5} min={0} unit="kg" onChange={setWeight} />
          <Stepper value={reps} step={1} min={1} unit="reps" onChange={setReps} />
          <button
            onClick={() => onLog(slot, reps, weight)}
            className="px-5 bg-volt text-ink font-display font-semibold tracking-wider active:bg-voltdim"
          >
            LOG
          </button>
        </div>
      )}
    </section>
  );
}
