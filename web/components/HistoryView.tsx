"use client";
/* Past workouts. A flat list of sessions; open one to see its sets grouped by exercise; tap a
   set to edit or remove it in a sheet. Same queue-backed endpoints as the player. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import NumField from "./NumField";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";
import PageHeader from "./ui/PageHeader";

type HSet = { id: string; exercise_id: string; name: string; reps: number | null; weight_kg: number | null; rpe: number | null; set_type: string | null; duration_s: number | null; distance_m: number | null; est_kcal: number | null; logged_at: string };
type HSession = { session_id: string; started_at: string; completed_at: string | null; sets: HSet[] };

function fmtSet(s: HSet): string {
  if (s.duration_s != null) {
    const km = s.distance_m ? ` · ${(s.distance_m / 1000).toFixed(1)} km` : "";
    const kcal = s.est_kcal ? ` · ~${s.est_kcal} kcal` : "";
    return `${Math.round(s.duration_s / 60)} min${km}${kcal}`;
  }
  const tag = s.set_type && s.set_type !== "normal" ? ` · ${s.set_type}` : "";
  const rpe = s.rpe != null ? ` · RPE ${s.rpe}` : "";
  return `${s.weight_kg ?? "–"} kg × ${s.reps ?? "–"}${rpe}${tag}`;
}
const prettyDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const prettyTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function HistoryView() {
  const [sessions, setSessions] = useState<HSession[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ sid: string; set: HSet } | null>(null);
  const [eReps, setEReps] = useState(8);
  const [eWeight, setEWeight] = useState(20);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<{ sessions: HSession[] }>("/api/sessions?limit=50")
      .then((d) => { setSessions(d.sessions); setState("ok"); if (d.sessions[0]) setOpen(d.sessions[0].session_id); })
      .catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  const saveEdit = () => {
    if (!edit) return;
    const { sid, set } = edit;
    setSessions((prev) => prev!.map((s) => (s.session_id === sid ? { ...s, sets: s.sets.map((x) => (x.id === set.id ? { ...x, reps: eReps, weight_kg: eWeight } : x)) } : s)));
    void enqueue("/api/sets/update", { session_id: sid, set_id: set.id, reps: eReps, weight_kg: eWeight });
    setEdit(null);
  };
  const removeSet = () => {
    if (!edit) return;
    const { sid, set } = edit;
    setSessions((prev) => prev!.map((s) => (s.session_id === sid ? { ...s, sets: s.sets.filter((x) => x.id !== set.id) } : s)).filter((s) => s.sets.length > 0));
    void enqueue("/api/sets/delete", { session_id: sid, set_id: set.id });
    setEdit(null);
  };

  const header = <PageHeader eyebrow="Past workouts" title="History" right={<Link href="/train" className="btn btn-ghost h-10 px-4 text-sm">Train</Link>} />;

  if (state === "unconfigured") return <div className="space-y-6">{header}<div className="card p-5"><Empty line="Paste your access token once and everything goes live." action="Open Setup" href="/settings" compact /></div></div>;
  if (state === "error") return <div className="space-y-6">{header}<div className="card p-5"><Empty line="Can't reach the server. History loads when you're back online." compact /></div></div>;
  if (state === "loading" || !sessions) return <div className="space-y-6">{header}<div className="card h-28 animate-pulse" /></div>;
  if (sessions.length === 0) return <div className="space-y-6">{header}<div className="card p-5"><Empty line="No workouts yet. Finish one and it lands here." action="Home" href="/" compact /></div></div>;

  return (
    <div className="space-y-5">
      {header}
      <div>
        {sessions.map((s) => (
          <SessionRow key={s.session_id} session={s} open={open === s.session_id}
            onToggle={() => setOpen((o) => (o === s.session_id ? null : s.session_id))}
            onSet={(set) => { setEdit({ sid: s.session_id, set }); setEReps(set.reps ?? 8); setEWeight(set.weight_kg ?? 20); }} />
        ))}
      </div>

      <Sheet open={edit != null} onClose={() => setEdit(null)} eyebrow={edit ? prettyDate(edit.set.logged_at) : undefined} title={edit?.set.name}>
        {edit && edit.set.duration_s == null ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <NumField value={eWeight} onChange={setEWeight} step={2.5} min={0} max={1000} decimals={1} unit="kg" />
              <NumField value={eReps} onChange={setEReps} step={1} min={1} max={100} unit="reps" />
            </div>
            <button onClick={saveEdit} className="btn btn-primary w-full h-14 mt-5 text-base">Save</button>
          </>
        ) : edit ? (
          <p className="t-sec tnum">{fmtSet(edit.set)}</p>
        ) : null}
        <button onClick={removeSet} className="btn btn-quiet w-full h-10 mt-1 text-sm text-alert">Remove this set</button>
      </Sheet>
    </div>
  );
}

function SessionRow({ session, open, onToggle, onSet }: { session: HSession; open: boolean; onToggle: () => void; onSet: (s: HSet) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; sets: HSet[] }>();
    for (const s of session.sets) {
      if (!m.has(s.exercise_id)) m.set(s.exercise_id, { name: s.name, sets: [] });
      m.get(s.exercise_id)!.sets.push(s);
    }
    return [...m.values()];
  }, [session.sets]);
  const volume = session.sets.reduce((t, s) => t + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);

  return (
    <div className="border-b border-line">
      <button onClick={onToggle} className="w-full text-left py-3.5 flex items-center gap-3" aria-expanded={open}>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium">{prettyDate(session.started_at)}<span className="t-sec font-normal ml-2">{prettyTime(session.started_at)}</span></p>
          <p className="t-sec mt-0.5 tnum">
            {session.sets.length} set{session.sets.length === 1 ? "" : "s"} · {groups.length} exercise{groups.length === 1 ? "" : "s"}
            {volume > 0 ? ` · ${Math.round(volume).toLocaleString()} kg` : ""}{session.completed_at ? "" : " · in progress"}
          </p>
        </div>
        <span className="text-dim" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
      </button>
      {open && (
        <div className="pb-3 space-y-3">
          {groups.map((g) => (
            <div key={g.name}>
              <p className="eyebrow mb-1">{g.name}</p>
              {g.sets.map((set, i) => (
                <button key={set.id} onClick={() => onSet(set)} className="w-full flex items-center gap-3 py-1.5 text-[15px] text-left active:text-volt">
                  <span className="font-mono text-xs text-dim w-4 tnum">{i + 1}</span>
                  <span className="tnum">{fmtSet(set)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
