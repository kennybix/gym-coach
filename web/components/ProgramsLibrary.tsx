"use client";
/* The program library: keep several programs, run them in parallel (toggle active), and add new
   ones from a curated template or by describing a goal (the coach designs it — e.g. "kegels").
   Generated/template programs land in a review screen you can edit before installing. */
import { useCallback, useEffect, useState } from "react";
import {
  addProgram, clearInactivePrograms, configured, deleteProgram, designProgram, getTemplate, listPrograms,
  listTemplates, setProgramActive, setProgramSchedule, type DesignedProgram, type ProgramSummary, type TemplateSummary,
} from "@/lib/api";

const DOW = ["S", "M", "T", "W", "T", "F", "S"]; // 0=Sun..6=Sat
import NumField from "./NumField";

type View = { kind: "list" } | { kind: "add" } | { kind: "review"; draft: DesignedProgram };

export default function ProgramsLibrary() {
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!configured()) return;
    listPrograms().then(setPrograms).catch(() => {});
  }, []);
  useEffect(() => { refresh(); listTemplates().then(setTemplates).catch(() => {}); }, [refresh]);

  const openTemplate = async (key: string) => {
    setBusy(true); setMsg(null);
    try { setView({ kind: "review", draft: await getTemplate(key) }); } catch { setMsg("Couldn't load that template."); }
    setBusy(false);
  };

  const design = async () => {
    if (!goal.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await designProgram(goal.trim());
      if ("unavailable" in r) setMsg("The coach is off right now, so I can't design programs. Try a template.");
      else if (!r.exercises.length) setMsg("I couldn't turn that into a program — try rephrasing the goal.");
      else setView({ kind: "review", draft: r });
    } catch { setMsg("Something went wrong designing that."); }
    setBusy(false);
  };

  const toggle = async (p: ProgramSummary) => {
    setPrograms((xs) => xs.map((x) => (x.program_id === p.program_id ? { ...x, is_active: !x.is_active } : x)));
    await setProgramActive(p.program_id, !p.is_active);
  };
  const remove = async (p: ProgramSummary) => {
    setPrograms((xs) => xs.filter((x) => x.program_id !== p.program_id));
    await deleteProgram(p.program_id);
  };
  const schedule = async (p: ProgramSummary, day: number) => {
    const days = p.scheduled_days.includes(day)
      ? p.scheduled_days.filter((d) => d !== day)
      : [...p.scheduled_days, day].sort((a, b) => a - b);
    setPrograms((xs) => xs.map((x) => (x.program_id === p.program_id ? { ...x, scheduled_days: days } : x)));
    await setProgramSchedule(p.program_id, days);
  };

  // ---- review/install ----
  if (view.kind === "review") {
    const d = view.draft;
    const patch = (i: number, k: "sets" | "reps", v: number) =>
      setView({ kind: "review", draft: { ...d, exercises: d.exercises.map((e, j) => (j === i ? { ...e, [k]: Math.round(v) } : e)) } });
    const removeEx = (i: number) => setView({ kind: "review", draft: { ...d, exercises: d.exercises.filter((_, j) => j !== i) } });
    const install = async () => {
      await addProgram({ name: d.name, goal: d.goal, sessions_per_week: d.sessions_per_week,
        exercises: d.exercises.map((e) => ({ exercise_id: e.exercise_id, sets: e.sets, reps: e.reps })) });
      setView({ kind: "list" }); setGoal(""); refresh();
    };
    return (
      <div className="space-y-3.5">
        <button onClick={() => setView({ kind: "add" })} className="text-dim text-sm active:text-volt">‹ Back</button>
        <div className="card p-5 space-y-3">
          <input value={d.name} onChange={(e) => setView({ kind: "review", draft: { ...d, name: e.target.value } })}
            className="field h-11 w-full px-3 text-base font-semibold outline-none" />
          <p className="text-dim text-xs">{d.goal} · {d.sessions_per_week}×/week · review and adjust, then install.</p>
          {d.note && <p className="text-xs text-bone/80 bg-panel2 border border-line rounded-lg p-2.5 leading-snug">ⓘ {d.note}</p>}
          <div className="space-y-2.5">
            {d.exercises.map((e, i) => (
              <div key={i} className="field p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">{e.name}</span>
                  <button onClick={() => removeEx(i)} aria-label="remove" className="text-dim hover:text-alert px-1 text-lg shrink-0">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="text-dim text-[11px] mb-1">Sets</p><NumField value={e.sets} onChange={(v) => patch(i, "sets", v)} step={1} min={1} max={20} compact /></div>
                  <div><p className="text-dim text-[11px] mb-1">Reps</p><NumField value={e.reps} onChange={(v) => patch(i, "reps", v)} step={1} min={1} max={600} compact /></div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={install} disabled={!d.exercises.length} className="btn btn-primary w-full h-12">Add to my programs</button>
        </div>
      </div>
    );
  }

  // ---- add (templates + design-a-goal) ----
  if (view.kind === "add") {
    return (
      <div className="space-y-3.5">
        <button onClick={() => setView({ kind: "list" })} className="text-dim text-sm active:text-volt">‹ Back</button>
        <div className="card p-5 space-y-3">
          <p className="eyebrow">Design for a goal</p>
          <p className="text-dim text-xs">Tell the coach what you want — e.g. “kegels”, “better posture”, “5k in 8 weeks”.</p>
          <div className="flex gap-2">
            <input value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && design()}
              placeholder="Your goal…" className="field flex-1 min-w-0 h-11 px-3 text-sm outline-none" autoCapitalize="off" />
            <button onClick={design} disabled={busy || !goal.trim()} className="btn btn-primary px-4 text-sm shrink-0">{busy ? "…" : "Design"}</button>
          </div>
          {msg && <p className="text-alert text-xs">{msg}</p>}
        </div>
        <div className="card p-5">
          <p className="eyebrow mb-3">Or start from a template</p>
          <div className="space-y-2">
            {templates.map((t) => (
              <button key={t.key} onClick={() => openTemplate(t.key)} disabled={busy}
                className="w-full field p-3 flex items-center justify-between active:border-volt text-left">
                <span className="min-w-0"><span className="block text-sm font-medium truncate">{t.name}</span>
                  <span className="block text-dim text-xs">{t.goal} · {t.count} exercises · {t.sessions_per_week}×/wk</span></span>
                <span className="text-dim text-lg shrink-0">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- list ----
  return (
    <div className="space-y-3.5">
      <button onClick={() => { setView({ kind: "add" }); setMsg(null); }} className="btn btn-primary w-full h-12">+ Add a program</button>
      {programs.length === 0 ? (
        <div className="card p-5"><p className="text-dim text-sm">No programs yet. Add one from a template or design it from a goal.</p></div>
      ) : (
        <div className="space-y-2.5">
          {programs.map((p) => (
            <div key={p.program_id} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-dim text-xs">{p.goal ? `${p.goal} · ` : ""}{p.exercises} exercises</p>
                </div>
                <button onClick={() => toggle(p)} className={`chip px-2.5 py-1 text-[11px] font-semibold shrink-0 ${p.is_active ? "text-ink bg-volt border-volt" : "text-dim"}`}>
                  {p.is_active ? "Active" : "Off"}
                </button>
                <button onClick={() => remove(p)} aria-label="delete" className="text-dim hover:text-alert px-1 text-lg shrink-0">×</button>
              </div>
              {p.is_active && (
                <div className="flex items-center gap-1 mt-3">
                  {DOW.map((d, i) => {
                    const set = p.scheduled_days.includes(i);
                    return (
                      <button key={i} onClick={() => schedule(p, i)}
                        className={`w-7 h-7 rounded-md text-[11px] font-semibold transition-colors ${set ? "bg-volt text-ink" : "bg-panel2 text-dim active:text-bone"}`}>
                        {d}
                      </button>
                    );
                  })}
                  <span className="text-dim text-[11px] ml-2">{p.scheduled_days.length === 0 || p.scheduled_days.length === 7 ? "every day" : "scheduled"}</span>
                </div>
              )}
            </div>
          ))}
          <p className="text-dim text-xs px-1">Pick the days a program runs (none = every day). Today shows only what&apos;s scheduled. Toggle Off to pause without deleting.</p>
          {programs.filter((p) => !p.is_active).length > 1 && (
            <button
              onClick={async () => { await clearInactivePrograms(); refresh(); }}
              className="text-dim text-xs active:text-alert underline underline-offset-2 px-1"
            >
              Clear {programs.filter((p) => !p.is_active).length} paused / old programs
            </button>
          )}
        </div>
      )}
    </div>
  );
}
