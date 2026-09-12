"use client";
/* The program library. Each program is a card you can read at a glance (goal, exercises,
   sessions/week, which days it runs), toggle on/off, schedule, open to edit, or remove (with a
   confirm). Adding a program (template or design-from-a-goal, then review) happens in a sheet. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addProgram, clearInactivePrograms, configured, deleteProgram, designProgram, getTemplate, listPrograms,
  listTemplates, setProgramActive, setProgramSchedule, type DesignedProgram, type ProgramSummary, type TemplateSummary,
} from "@/lib/api";
import NumField from "./NumField";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";

const DOW = ["S", "M", "T", "W", "T", "F", "S"]; // 0=Sun..6=Sat

export default function ProgramsLibrary() {
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DesignedProgram | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<ProgramSummary | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(() => {
    if (!configured()) return setPrograms([]);
    listPrograms().then(setPrograms).catch(() => setPrograms([]));
  }, []);
  useEffect(() => { refresh(); listTemplates().then(setTemplates).catch(() => {}); }, [refresh]);

  const openTemplate = async (key: string) => {
    setBusy(true); setMsg(null);
    try { setDraft(await getTemplate(key)); } catch { setMsg("Couldn't load that template."); }
    setBusy(false);
  };
  const design = async () => {
    if (!goal.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await designProgram(goal.trim());
      if ("unavailable" in r) setMsg("The coach is off right now. Start from a template instead.");
      else if (!r.exercises.length) setMsg("Couldn't turn that into a program. Try rephrasing the goal.");
      else setDraft(r);
    } catch { setMsg("Something went wrong designing that."); }
    setBusy(false);
  };
  const install = async () => {
    if (!draft) return;
    await addProgram({ name: draft.name, goal: draft.goal, sessions_per_week: draft.sessions_per_week,
      exercises: draft.exercises.map((e) => ({ exercise_id: e.exercise_id, sets: e.sets, reps: e.reps })) });
    setDraft(null); setAdding(false); setGoal(""); refresh();
  };
  const toggle = async (p: ProgramSummary) => {
    setPrograms((xs) => xs!.map((x) => (x.program_id === p.program_id ? { ...x, is_active: !x.is_active } : x)));
    await setProgramActive(p.program_id, !p.is_active);
  };
  const remove = async (p: ProgramSummary) => {
    setPrograms((xs) => xs!.filter((x) => x.program_id !== p.program_id));
    setConfirmDel(null);
    await deleteProgram(p.program_id);
  };
  const schedule = async (p: ProgramSummary, day: number) => {
    const days = p.scheduled_days.includes(day) ? p.scheduled_days.filter((d) => d !== day) : [...p.scheduled_days, day].sort((a, b) => a - b);
    setPrograms((xs) => xs!.map((x) => (x.program_id === p.program_id ? { ...x, scheduled_days: days } : x)));
    await setProgramSchedule(p.program_id, days);
  };

  const paused = (programs ?? []).filter((p) => !p.is_active).length;

  return (
    <div className="space-y-5">
      {programs === null ? (
        <div className="card h-28 animate-pulse" />
      ) : programs.length === 0 ? (
        <div className="card p-5"><Empty line="No programs yet." action="Add one" onAction={() => setAdding(true)} compact /></div>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <div key={p.program_id} className={`rise ${p.is_active ? "card-lift" : "card"} p-4`}>
              <div className="flex items-start gap-3">
                <Link href={`/program?id=${p.program_id}`} className="min-w-0 flex-1 active:opacity-70">
                  <p className="t-h2 truncate">{p.name}</p>
                  <p className="t-sec mt-1 tnum">{p.goal ? `${p.goal} · ` : ""}{p.exercises} exercise{p.exercises === 1 ? "" : "s"} · {p.sessions_per_week}×/week</p>
                </Link>
                <button onClick={() => toggle(p)} aria-pressed={p.is_active} className={`chip px-3 py-1.5 text-[11px] font-semibold shrink-0 font-mono ${p.is_active ? "chip-on" : "text-dim"}`}>
                  {p.is_active ? "ON" : "OFF"}
                </button>
              </div>
              {p.is_active && (
                <div className="flex items-center gap-1.5 mt-3">
                  {DOW.map((d, i) => {
                    const set = p.scheduled_days.includes(i);
                    return (
                      <button key={i} onClick={() => schedule(p, i)} aria-pressed={set}
                        className={`w-8 h-8 rounded-full text-[11px] font-mono font-semibold transition-colors ${set ? "bg-volt text-onvolt" : "bg-panel2 text-dim active:text-bone"}`}>
                        {d}
                      </button>
                    );
                  })}
                  <span className="t-sec ml-auto">{p.scheduled_days.length === 0 || p.scheduled_days.length === 7 ? "every day" : `${p.scheduled_days.length} days`}</span>
                </div>
              )}
              <div className="flex items-center gap-3 mt-3">
                <Link href={`/program?id=${p.program_id}`} className="btn btn-ghost h-9 px-3.5 text-xs">Edit</Link>
                <button onClick={() => setConfirmDel(p)} className="btn btn-quiet h-9 px-2 text-xs">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => { setAdding(true); setMsg(null); }} className="btn btn-primary w-full h-12">+ Add a program</button>
      {paused > 1 && (
        <button onClick={() => setConfirmClear(true)} className="btn btn-quiet w-full h-9 text-xs">Clear {paused} paused programs</button>
      )}
      <p className="t-sec leading-snug">Programs that are on run on their chosen days. Home shows only what's scheduled today.</p>

      {/* add sheet */}
      <Sheet open={adding && !draft} onClose={() => setAdding(false)} title="Add a program">
        <p className="eyebrow mb-2">Design for a goal</p>
        <div className="flex gap-2">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && design()}
            placeholder="e.g. stronger back, 5k in 8 weeks" className="field flex-1 min-w-0 h-12 px-4 text-[15px] outline-none" autoCapitalize="off" />
          <button onClick={design} disabled={busy || !goal.trim()} className="btn btn-primary h-12 px-4 text-sm shrink-0">{busy ? "…" : "Design"}</button>
        </div>
        {msg && <p className="text-alert text-sm mt-2">{msg}</p>}
        <p className="eyebrow mt-5 mb-1">Or start from a template</p>
        <div>
          {templates.map((t) => (
            <button key={t.key} onClick={() => openTemplate(t.key)} disabled={busy} className="row">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium truncate">{t.name}</span>
                <span className="block t-sec">{t.goal} · {t.count} exercises · {t.sessions_per_week}×/week</span>
              </span>
              <span className="text-dim">›</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* review sheet */}
      <Sheet open={draft != null} onClose={() => setDraft(null)} eyebrow="Review, then add" title={draft?.name}>
        {draft && (
          <div className="space-y-3">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="field h-12 w-full px-4 text-[15px] font-semibold outline-none" />
            <p className="t-sec">{draft.goal} · {draft.sessions_per_week}×/week</p>
            {draft.note && <p className="text-sm bg-panel2 border border-line rounded-xl p-3 leading-snug">{draft.note}</p>}
            <div className="max-h-[40dvh] overflow-auto scroll-soft">
              {draft.exercises.map((e, i) => (
                <div key={i} className="row">
                  <span className="flex-1 min-w-0 truncate text-[15px]">{e.name}</span>
                  <div className="w-20"><NumField value={e.sets} onChange={(v) => setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? { ...x, sets: Math.round(v) } : x)) })} step={1} min={1} max={20} compact /></div>
                  <span className="text-dim">×</span>
                  <div className="w-20"><NumField value={e.reps} onChange={(v) => setDraft({ ...draft, exercises: draft.exercises.map((x, j) => (j === i ? { ...x, reps: Math.round(v) } : x)) })} step={1} min={1} max={600} compact /></div>
                  <button onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, j) => j !== i) })} aria-label="remove" className="text-dim active:text-alert px-1 text-lg">×</button>
                </div>
              ))}
            </div>
            <button onClick={install} disabled={!draft.exercises.length} className="btn btn-primary w-full h-14 text-base">Add to my programs</button>
          </div>
        )}
      </Sheet>

      <Sheet open={confirmDel != null} onClose={() => setConfirmDel(null)} title={`Remove ${confirmDel?.name}?`}>
        <p className="t-sec">Past workouts stay in History. The program itself goes.</p>
        <button onClick={() => confirmDel && remove(confirmDel)} className="btn btn-primary w-full h-14 mt-5 text-base">Remove program</button>
        <button onClick={() => setConfirmDel(null)} className="btn btn-quiet w-full h-10 mt-1 text-sm">Keep it</button>
      </Sheet>
      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={`Clear ${paused} paused programs?`}>
        <p className="t-sec">History is untouched. Only programs that are off are removed.</p>
        <button onClick={async () => { await clearInactivePrograms(); setConfirmClear(false); refresh(); }} className="btn btn-primary w-full h-14 mt-5 text-base">Clear them</button>
        <button onClick={() => setConfirmClear(false)} className="btn btn-quiet w-full h-10 mt-1 text-sm">Keep them</button>
      </Sheet>
    </div>
  );
}
