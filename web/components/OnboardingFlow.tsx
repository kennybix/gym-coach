"use client";
/* First run. One task per screen, big numbers, a real progress bar (the steps ARE a sequence).
   Safety choices are unchanged: pace options stop at the safe cap (server clamps anyway),
   disclosing an eating-disorder history keeps automated calorie targets off, and the Ready
   screen explains that supportively. The program step is template-first: pick one, have the
   coach design one from a goal, or build your own from the catalog. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addProgram, apiPost, designProgram, getTemplate, listTemplates,
  type DesignedProgram, type TemplateSummary,
} from "@/lib/api";
import CatalogSearch, { type CatalogRow } from "./CatalogSearch";
import NumField from "./NumField";
import ThemePicker from "./ThemePicker";
import Sheet from "./ui/Sheet";

type Step = 0 | 1 | 2 | 3 | 4 | 5;
const STEPS = ["Welcome", "About you", "Your goal", "Health", "Your program", "Ready"];
const RATES = [0.25, 0.5, 0.75, 1.0]; // kg/week — the list stops at the safe cap by design
type Ex = { exercise_id: string; name: string; sets: number; reps: number; category?: string | null };
type Draft = { name: string; goal: string | null; sessions_per_week: number; exercises: Ex[]; note?: string | null };
type Done = { targets_disabled: boolean; rate_capped: boolean; note?: string; target?: { daily_kcal: number; protein_g: number } };

export default function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  // about
  const [sex, setSex] = useState<"male" | "female" | "other">("male");
  const [birthYear, setBirthYear] = useState(1990);
  const [heightCm, setHeightCm] = useState(175);
  const [activity, setActivity] = useState("moderate");
  // goal
  const [currentKg, setCurrentKg] = useState(85);
  const [goalKg, setGoalKg] = useState(78);
  const [rate, setRate] = useState(0.5);
  // health
  const [injury, setInjury] = useState(false);
  const [edHistory, setEdHistory] = useState(false);
  const [addVitals, setAddVitals] = useState(false);
  const [bSys, setBSys] = useState(120);
  const [bDia, setBDia] = useState(80);
  const [bHr, setBHr] = useState(70);
  // program
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [goalText, setGoalText] = useState("");
  const [designing, setDesigning] = useState(false);
  const [designMsg, setDesignMsg] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  // submit
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listTemplates().then(setTemplates).catch(() => {}); }, []);

  const year = new Date().getFullYear();
  const age = year - birthYear;
  const weeksToGoal = useMemo(() => {
    const diff = currentKg - goalKg;
    return diff > 0 && rate > 0 ? Math.round(diff / rate) : null;
  }, [currentKg, goalKg, rate]);

  const pickTemplate = async (key: string) => {
    try {
      const t = await getTemplate(key);
      setDraft({ name: t.name, goal: t.goal, sessions_per_week: t.sessions_per_week, exercises: t.exercises.map((e) => ({ ...e })), note: t.note });
    } catch { setDesignMsg("Couldn't load that template."); }
  };
  const design = async () => {
    if (!goalText.trim()) return;
    setDesigning(true); setDesignMsg(null);
    try {
      const r = await designProgram(goalText.trim());
      if ("unavailable" in r) setDesignMsg("The coach is off right now. Pick a template or build your own.");
      else if (!r.exercises.length) setDesignMsg("Couldn't turn that into a program. Try rephrasing.");
      else setDraft({ name: r.name, goal: r.goal, sessions_per_week: r.sessions_per_week, exercises: r.exercises.map((e) => ({ ...e })), note: r.note });
    } catch { setDesignMsg("Something went wrong designing that."); }
    setDesigning(false);
  };
  const startOwn = () => { setDraft({ name: "My program", goal: null, sessions_per_week: 3, exercises: [] }); setBuilding(true); };
  const toggleOwn = (r: CatalogRow) => setDraft((d) => {
    if (!d) return d;
    const has = d.exercises.some((e) => e.exercise_id === r.exercise_id);
    return { ...d, exercises: has ? d.exercises.filter((e) => e.exercise_id !== r.exercise_id) : [...d.exercises, { exercise_id: r.exercise_id, name: r.name, sets: 3, reps: 8, category: r.category }] };
  });
  const tweak = (i: number, k: "sets" | "reps", dlt: number) =>
    setDraft((d) => d && { ...d, exercises: d.exercises.map((e, j) => (j === i ? { ...e, [k]: Math.max(1, e[k] + dlt) } : e)) });
  const removeEx = (i: number) => setDraft((d) => d && { ...d, exercises: d.exercises.filter((_, j) => j !== i) });

  const submit = useCallback(async () => {
    if (!draft || draft.exercises.length === 0) return;
    setBusy(true); setError(null);
    try {
      const ob = await apiPost<Done>("/api/onboarding", {
        sex, birth_year: birthYear, height_cm: heightCm, activity_level: activity,
        current_weight_kg: currentKg, goal_weight_kg: goalKg, weekly_rate_kg: rate,
        injury_active: injury, eating_disorder_history: edHistory,
      });
      await addProgram({
        name: draft.name || "My program", goal: draft.goal, sessions_per_week: draft.sessions_per_week,
        exercises: draft.exercises.map((e) => ({ exercise_id: e.exercise_id, sets: e.sets, reps: e.reps })),
      });
      if (addVitals) {
        try {
          await apiPost("/api/vitals", { id: crypto.randomUUID(), recorded_at: new Date().toISOString(), systolic: bSys, diastolic: bDia, heart_rate: bHr, tag: "baseline" });
        } catch { /* a vitals hiccup shouldn't fail onboarding */ }
      }
      try { localStorage.setItem("coach_onboarded", "1"); } catch {}
      setDone(ob);
      setStep(5);
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    } catch {
      setError("Couldn't save. Check your connection and token, then try again.");
    } finally { setBusy(false); }
  }, [draft, sex, birthYear, heightCm, activity, currentKg, goalKg, rate, injury, edHistory, addVitals, bSys, bDia, bHr]);

  const canNext = step === 4 ? Boolean(draft && draft.exercises.length > 0) : true;
  const next = () => (step === 4 ? submit() : setStep((s) => (s + 1) as Step));

  return (
    <div className="space-y-6">
      <header className="rise">
        <p className="eyebrow">{step === 5 ? "All set" : `Step ${step + 1} of ${STEPS.length - 1}`}</p>
        <h1 className="t-title mt-1.5">{STEPS[step]}</h1>
        <div className="flex gap-1.5 mt-4" aria-hidden>
          {STEPS.slice(0, 5).map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= Math.min(step, 4) ? "bg-volt" : "bg-line"}`} />)}
        </div>
      </header>

      {step === 0 && (
        <section className="space-y-6 rise">
          <p className="text-[17px] leading-relaxed">A private coach over your own logs. Training, food, weight and vitals stay on your server; the coach reads them before it says anything.</p>
          <div>
            <p className="eyebrow mb-3">Choose a look</p>
            <ThemePicker />
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5 rise">
          <Field label="Sex">
            <Chips value={sex} options={["male", "female", "other"]} onPick={(v) => setSex(v as typeof sex)} />
          </Field>
          <Field label={`Birth year · age ${age}`}>
            <NumField value={birthYear} onChange={(v) => setBirthYear(Math.round(v))} step={1} min={1920} max={year - 13} />
          </Field>
          <Field label="Height">
            <NumField value={heightCm} onChange={setHeightCm} step={1} min={100} max={250} unit="cm" />
          </Field>
          <Field label="Activity outside training">
            <Chips value={activity} options={["sedentary", "light", "moderate", "active"]} onPick={setActivity} />
          </Field>
          <p className="t-sec">Tap any number to type it.</p>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5 rise">
          <Field label="Weight now"><NumField value={currentKg} onChange={setCurrentKg} step={0.5} min={30} max={400} decimals={1} unit="kg" /></Field>
          <Field label="Goal weight"><NumField value={goalKg} onChange={setGoalKg} step={0.5} min={30} max={400} decimals={1} unit="kg" /></Field>
          <Field label="Pace">
            <div className="grid grid-cols-4 gap-2">
              {RATES.map((r) => <button key={r} data-on={rate === r} onClick={() => setRate(r)} className="seg h-12 tnum text-sm">{r} kg</button>)}
            </div>
            <p className="t-sec mt-2 tnum">
              per week · sustainable beats fast{weeksToGoal ? ` · about ${weeksToGoal} weeks at this pace` : ""}. Your coach adjusts pace from what you actually log.
            </p>
          </Field>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-3 rise">
          <Toggle label="I'm managing an injury right now" sub="The coach won't intensify your program until it's cleared." on={injury} onToggle={() => setInjury((v) => !v)} />
          <Toggle label="I have a history of disordered eating" sub="Automated calorie targets stay off. The app focuses on training, and nutrition guidance belongs with specialised professionals." on={edHistory} onToggle={() => setEdHistory((v) => !v)} />
          <Toggle label="Log a baseline blood pressure and heart rate" sub="Optional. Your vitals trend starts from day one." on={addVitals} onToggle={() => setAddVitals((v) => !v)} />
          {addVitals && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0"><NumField value={bSys} onChange={setBSys} step={1} min={50} max={260} unit="sys" compact /></div>
                <span className="text-dim text-xl font-display">/</span>
                <div className="flex-1 min-w-0"><NumField value={bDia} onChange={setBDia} step={1} min={30} max={160} unit="dia" compact /></div>
              </div>
              <NumField label="Heart rate" value={bHr} onChange={setBHr} step={1} min={30} max={230} unit="bpm" compact />
            </div>
          )}
          <p className="t-sec leading-relaxed pt-1">These only tune safety behaviour. Stored in your own database, shown to no one.</p>
        </section>
      )}

      {step === 4 && !draft && (
        <section className="space-y-5 rise">
          <div>
            <p className="eyebrow mb-1">Start from a template</p>
            {templates.length === 0 && <p className="t-sec py-2">Loading templates…</p>}
            {templates.map((t) => (
              <button key={t.key} onClick={() => pickTemplate(t.key)} className="row">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium truncate">{t.name}</span>
                  <span className="block t-sec">{t.goal} · {t.count} exercises · {t.sessions_per_week}×/week</span>
                </span>
                <span className="text-dim">›</span>
              </button>
            ))}
          </div>
          <div>
            <p className="eyebrow mb-2">Or tell the coach your goal</p>
            <div className="flex gap-2">
              <input value={goalText} onChange={(e) => setGoalText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && design()} placeholder="e.g. lose fat, keep strength, 3 days" className="field flex-1 min-w-0 h-12 px-4 text-[15px] outline-none" autoCapitalize="off" />
              <button onClick={design} disabled={designing || !goalText.trim()} className="btn btn-primary h-12 px-4 text-sm shrink-0">{designing ? "…" : "Design"}</button>
            </div>
            {designMsg && <p className="text-alert text-sm mt-2">{designMsg}</p>}
          </div>
          <button onClick={startOwn} className="btn btn-ghost w-full h-12">Build my own from the catalog</button>
          <button onClick={() => setStep(3)} className="btn btn-quiet w-full h-10 text-sm">Back</button>
        </section>
      )}

      {step === 4 && draft && (
        <section className="space-y-4 rise pb-20">
          <div className="flex items-center justify-between gap-3">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Program name" className="t-h2 bg-transparent outline-none flex-1 min-w-0 border-b border-transparent focus:border-line" />
            <button onClick={() => setDraft(null)} className="btn btn-quiet h-9 px-2 text-xs shrink-0">Change</button>
          </div>
          {draft.note && <p className="text-sm bg-panel2 border border-line rounded-xl p-3 leading-snug">{draft.note}</p>}
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium">Sessions per week</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setDraft({ ...draft, sessions_per_week: Math.max(1, draft.sessions_per_week - 1) })} className="iconbtn text-xl">−</button>
              <span className="t-num text-xl w-6 text-center">{draft.sessions_per_week}</span>
              <button onClick={() => setDraft({ ...draft, sessions_per_week: Math.min(7, draft.sessions_per_week + 1) })} className="iconbtn text-xl">+</button>
            </div>
          </div>
          <div>
            <p className="eyebrow mb-1">Exercises · {draft.exercises.length}</p>
            {draft.exercises.map((e, i) => (
              <div key={e.exercise_id} className="py-2.5 border-b border-line">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-[15px] font-medium">{e.name}</span>
                  <button onClick={() => removeEx(i)} aria-label="remove" className="text-dim active:text-alert w-7 text-lg leading-none shrink-0">×</button>
                </div>
                {e.category !== "cardio" ? (
                  <span className="flex items-center gap-1.5 mt-1.5 font-mono text-sm tnum">
                    <span className="t-sec mr-1">sets × reps</span>
                    <Mini value={e.sets} onDown={() => tweak(i, "sets", -1)} onUp={() => tweak(i, "sets", 1)} />
                    <span className="text-dim">×</span>
                    <Mini value={e.reps} onDown={() => tweak(i, "reps", -1)} onUp={() => tweak(i, "reps", 1)} />
                  </span>
                ) : <span className="block t-sec mt-1">cardio · logged by time</span>}
              </div>
            ))}
            <button onClick={() => setBuilding(true)} className="btn btn-ghost w-full h-11 mt-3 text-sm">+ Add exercises</button>
          </div>
        </section>
      )}

      {step === 5 && done && (
        <section className="space-y-5 rise">
          <div className="card-lift p-5">
            {done.targets_disabled ? (
              <p className="text-[15px] leading-relaxed">{done.note}</p>
            ) : (
              <>
                <p className="eyebrow">Starting point</p>
                <p className="t-hero mt-2 tnum">{done.target?.daily_kcal}<span className="text-dim text-2xl font-display font-semibold ml-1.5">kcal</span></p>
                <p className="t-sec mt-2 tnum">{done.target?.protein_g} g protein a day · a conservative estimate, nothing more. Your coach recalibrates it from what you log.{done.rate_capped ? " Your pace was set to the safe maximum." : ""}</p>
              </>
            )}
          </div>
          <div>
            <p className="eyebrow mb-1">What happens next</p>
            <div className="row"><span className="text-[15px]">Home shows today's workout. Start it when you're at the gym.</span></div>
            <div className="row"><span className="text-[15px]">Weigh in most mornings and log food most days. The trend and the estimate build from there.</span></div>
            <div className="row"><span className="text-[15px]">Every Monday the coach reviews your week and explains any change.</span></div>
          </div>
          <button onClick={() => router.push("/")} className="btn btn-primary w-full h-14 text-base">Go to Home</button>
        </section>
      )}

      {error && <p className="text-alert text-sm px-1">{error}</p>}

      {step < 5 && !(step === 4 && !draft) && (
        <div className="flex gap-2.5 sticky z-20" style={{ bottom: "calc(12px + env(safe-area-inset-bottom))" }}>
          {step > 0 && <button onClick={() => setStep((s) => (s - 1) as Step)} className="btn btn-ghost h-14 px-6">Back</button>}
          <button disabled={!canNext || busy} onClick={next} className="btn btn-primary flex-1 h-14 text-base shadow-lg">
            {step === 4 ? (busy ? "Saving…" : "Finish setup") : step === 0 ? "Let's go" : "Next"}
          </button>
        </div>
      )}

      <Sheet open={building} onClose={() => setBuilding(false)} title="Add exercises" action={<button onClick={() => setBuilding(false)} className="btn btn-primary h-10 px-4 text-sm">Done</button>}>
        <CatalogSearch onPick={toggleOwn} pickedIds={draft?.exercises.map((e) => e.exercise_id) ?? []} />
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </div>
  );
}
function Chips({ value, options, onPick }: { value: string; options: string[]; onPick: (v: string) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0,1fr))` }}>
      {options.map((o) => <button key={o} data-on={value === o} onClick={() => onPick(o)} className="seg h-12 text-sm capitalize">{o}</button>)}
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
function Toggle({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={on} className={`w-full text-left card p-4 flex items-start gap-3 transition-colors ${on ? "border-volt" : ""}`}>
      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? "bg-volt border-volt" : "border-line"}`}>
        {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-onvolt)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>}
      </span>
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block t-sec mt-1 leading-relaxed">{sub}</span>
      </span>
    </button>
  );
}
