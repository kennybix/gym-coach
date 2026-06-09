"use client";
/* Browse past workouts and fix their logs. Edits/removes reuse the same idempotent,
   queue-backed endpoints as Today (/api/sets/update, /api/sets/delete), scoped by
   session_id + set_id — so editing an old session works exactly like editing today's. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import NumField from "./NumField";

type HSet = { id: string; exercise_id: string; name: string; reps: number | null; weight_kg: number | null; rpe: number | null; set_type: string | null; duration_s: number | null; distance_m: number | null; est_kcal: number | null; logged_at: string };
type HSession = { session_id: string; started_at: string; completed_at: string | null; sets: HSet[] };

function fmtSet(s: HSet): string {
  if (s.duration_s != null) {
    const km = s.distance_m ? ` · ${(s.distance_m / 1000).toFixed(1)} km` : "";
    const kcal = s.est_kcal ? ` · ~${s.est_kcal} kcal` : "";
    return `${Math.round(s.duration_s / 60)} min${km}${kcal}`;
  }
  const tag = s.set_type && s.set_type !== "normal" ? ` (${s.set_type})` : "";
  const rpe = s.rpe != null ? ` · RPE ${s.rpe}` : "";
  return `${s.weight_kg ?? "—"} kg × ${s.reps ?? "—"}${rpe}${tag}`;
}

function prettyDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function prettyTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function HistoryView() {
  const [sessions, setSessions] = useState<HSession[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // set id
  const [eReps, setEReps] = useState(8);
  const [eWeight, setEWeight] = useState(20);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<{ sessions: HSession[] }>("/api/sessions?limit=50")
      .then((d) => {
        setSessions(d.sessions);
        setState("ok");
        if (d.sessions[0]) setOpen(d.sessions[0].session_id);
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  const saveEdit = useCallback(
    (sid: string, set: HSet) => {
      setSessions((prev) =>
        prev!.map((s) =>
          s.session_id === sid
            ? { ...s, sets: s.sets.map((x) => (x.id === set.id ? { ...x, reps: eReps, weight_kg: eWeight } : x)) }
            : s
        )
      );
      void enqueue("/api/sets/update", { session_id: sid, set_id: set.id, reps: eReps, weight_kg: eWeight });
      setEditing(null);
    },
    [eReps, eWeight]
  );

  const removeSet = useCallback((sid: string, setId: string) => {
    setSessions((prev) =>
      prev!
        .map((s) => (s.session_id === sid ? { ...s, sets: s.sets.filter((x) => x.id !== setId) } : s))
        .filter((s) => s.sets.length > 0)
    );
    void enqueue("/api/sets/delete", { session_id: sid, set_id: setId });
  }, []);

  if (state === "unconfigured")
    return <Wrap><Card><p className="text-dim text-sm">Set your token on Setup to see history.</p></Card></Wrap>;
  if (state === "error")
    return <Wrap><Card><p className="text-dim text-sm leading-relaxed">Can&apos;t reach the server right now — history will load when you&apos;re back online.</p></Card></Wrap>;
  if (state === "loading" || !sessions)
    return <Wrap><div className="card p-5 h-28 animate-pulse" /></Wrap>;
  if (sessions.length === 0)
    return (
      <Wrap>
        <Card>
          <p className="text-dim text-sm leading-relaxed">No logged workouts yet. Finish a session on Today and it&apos;ll show up here.</p>
          <Link href="/" className="btn btn-primary h-12 w-full mt-4">Go to Today</Link>
        </Card>
      </Wrap>
    );

  return (
    <Wrap>
      {sessions.map((s, i) => (
        <SessionCard
          key={s.session_id}
          session={s}
          index={i}
          open={open === s.session_id}
          onToggle={() => setOpen((o) => (o === s.session_id ? null : s.session_id))}
          editing={editing}
          startEdit={(set) => { setEditing(set.id); setEReps(set.reps ?? 8); setEWeight(set.weight_kg ?? 20); }}
          cancelEdit={() => setEditing(null)}
          saveEdit={(set) => saveEdit(s.session_id, set)}
          removeSet={(setId) => removeSet(s.session_id, setId)}
          eReps={eReps} setEReps={setEReps} eWeight={eWeight} setEWeight={setEWeight}
        />
      ))}
    </Wrap>
  );
}

function SessionCard({
  session, index, open, onToggle, editing, startEdit, cancelEdit, saveEdit, removeSet,
  eReps, setEReps, eWeight, setEWeight,
}: {
  session: HSession;
  index: number;
  open: boolean;
  onToggle: () => void;
  editing: string | null;
  startEdit: (s: HSet) => void;
  cancelEdit: () => void;
  saveEdit: (s: HSet) => void;
  removeSet: (id: string) => void;
  eReps: number; setEReps: (v: number) => void; eWeight: number; setEWeight: (v: number) => void;
}) {
  // group sets by exercise, preserving first-seen order
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; sets: HSet[] }>();
    for (const s of session.sets) {
      if (!m.has(s.exercise_id)) m.set(s.exercise_id, { name: s.name, sets: [] });
      m.get(s.exercise_id)!.sets.push(s);
    }
    return [...m.values()];
  }, [session.sets]);

  return (
    <div className="card overflow-hidden rise" style={{ animationDelay: `${index * 50}ms` }}>
      <button onClick={onToggle} className="w-full text-left p-4 flex items-center gap-3 active:bg-panel2">
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold">{prettyDate(session.started_at)}</p>
          <p className="text-dim text-xs mt-0.5">
            {prettyTime(session.started_at)} · {session.sets.length} set{session.sets.length === 1 ? "" : "s"} · {groups.length} exercise{groups.length === 1 ? "" : "s"}
            {session.completed_at ? "" : " · in progress"}
          </p>
        </div>
        <span className={`text-dim transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
          {groups.map((g) => (
            <div key={g.name}>
              <p className="text-sm font-medium text-bone/90 mb-1.5">{g.name}</p>
              <ul className="space-y-1.5">
                {g.sets.map((set, i) =>
                  editing === set.id && set.duration_s == null ? (
                    <li key={set.id} className="flex items-center gap-2">
                      <span className="text-dim tnum w-5 text-xs shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0"><NumField value={eWeight} onChange={setEWeight} step={2.5} min={0} max={1000} decimals={1} unit="kg" compact /></div>
                      <div className="flex-1 min-w-0"><NumField value={eReps} onChange={setEReps} step={1} min={1} max={100} unit="reps" compact /></div>
                      <button onClick={() => saveEdit(set)} className="btn btn-primary h-10 px-3 text-xs shrink-0">Save</button>
                      <button onClick={cancelEdit} aria-label="cancel" className="text-dim px-1.5 text-base shrink-0">×</button>
                    </li>
                  ) : (
                    <li key={set.id} className="flex items-center gap-2 text-sm">
                      <span className="text-dim tnum w-5 text-xs">{i + 1}</span>
                      {set.duration_s == null ? (
                        <button onClick={() => startEdit(set)} className="tnum text-bone/90 text-left active:text-volt">
                          {fmtSet(set)}<span className="text-dim text-xs ml-2">edit</span>
                        </button>
                      ) : (
                        <span className="tnum text-bone/90">{fmtSet(set)}</span>
                      )}
                      <button onClick={() => removeSet(set.id)} aria-label="remove set" className="ml-auto text-dim hover:text-alert px-2 text-base leading-none">×</button>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rise">
        <h1 className="font-display text-[28px] font-bold">History</h1>
        <Link href="/" className="btn btn-ghost h-9 px-3.5 text-xs">Today</Link>
      </div>
      {children}
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5 rise">{children}</div>;
}
