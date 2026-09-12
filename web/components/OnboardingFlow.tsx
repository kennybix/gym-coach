"use client";
/* First-run wizard. Notable choices:
 * - Weekly-rate options only go up to the safe cap (server clamps anyway; the UI
 *   simply doesn't offer aggressive rates).
 * - Screening step is plain and respectful; disclosing ED history disables automated
 *   calorie targets and the Done screen explains that supportively.
 * - Program builder searches the seeded catalog with equipment filters. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import NumField from "./NumField";

type Step = 0 | 1 | 2 | 3 | 4;
type CatalogRow = { exercise_id: string; name: string; equipment: string; primary_muscles: string[] };
type Picked = CatalogRow & { sets: number; reps: number };

const RATE_OPTIONS = [0.25, 0.5, 0.75, 1.0]; // kg/week — capped list by design
const EQUIPMENT = ["", "none", "dumbbell", "barbell", "kettlebell", "band", "cable", "machine"];
const STEP_TITLES = ["About you", "Your goal", "Screening", "Your program", "Ready"];

export default function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  // about
  const [sex, setSex] = useState<"male" | "female" | "other">("male");
  const [birthYear, setBirthYear] = useState(1990);
  const [heightCm, setHeightCm] = useState(175);
  const [activity, setActivity] = useState("moderate");
  const [currentKg, setCurrentKg] = useState(85);
  // goal
  const [goalKg, setGoalKg] = useState(78);
  const [rate, setRate] = useState(0.5);
  // baseline vitals (optional)
  const [addVitals, setAddVitals] = useState(false);
  const [bSys, setBSys] = useState(120);
  const [bDia, setBDia] = useState(80);
  const [bHr, setBHr] = useState(70);
  // screening
  const [injury, setInjury] = useState(false);
  const [edHistory, setEdHistory] = useState(false);
  // program
  const [perWeek, setPerWeek] = useState(3);
  const [query, setQuery] = useState("");
  const [equip, setEquip] = useState("");
  const [results, setResults] = useState<CatalogRow[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  // submit
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { targets_disabled: boolean; rate_capped: boolean; note?: string; target?: { daily_kcal: number; protein_g: number } }>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (equip) params.set("equipment", equip);
    apiGet<{ exercises: CatalogRow[] }>(`/api/catalog/exercises?${params}`)
      .then((d) => setResults(d.exercises))
      .catch(() => setResults([]));
  }, [query, equip]);

  useEffect(() => {
    if (step === 3) search();
  }, [step, search]);

  const add = (r: CatalogRow) =>
    setPicked((p) => (p.some((x) => x.exercise_id === r.exercise_id) ? p : [...p, { ...r, sets: 3, reps: 8 }]));
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.exercise_id !== id));
  const tweak = (id: string, k: "sets" | "reps", d: number) =>
    setPicked((p) => p.map((x) => (x.exercise_id === id ? { ...x, [k]: Math.max(1, x[k] + d) } : x)));

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ob = await apiPost<NonNullable<typeof done>>("/api/onboarding", {
        sex, birth_year: birthYear, height_cm: heightCm, activity_level: activity,
        current_weight_kg: currentKg, goal_weight_kg: goalKg, weekly_rate_kg: rate,
        injury_active: injury, eating_disorder_history: edHistory,
      });
      await apiPost("/api/program", {
        name: "Main", sessions_per_week: perWeek,
        exercises: picked.map((p) => ({ exercise_id: p.exercise_id, sets: p.sets, reps: p.reps })),
      });
      if (addVitals) {
        // best-effort: a vitals hiccup shouldn't fail an otherwise-complete onboarding
        try {
          await apiPost("/api/vitals", {
            id: crypto.randomUUID(), recorded_at: new Date().toISOString(),
            systolic: bSys, diastolic: bDia, heart_rate: bHr, tag: "baseline",
          });
        } catch { /* ignore */ }
      }
      setDone(ob);
      setStep(4);
    } catch {
      setError("Couldn't save — check your connection and token, then try again.");
    } finally {
      setBusy(false);
    }
  }, [sex, birthYear, heightCm, activity, currentKg, goalKg, rate, injury, edHistory, perWeek, picked]);

  const canNext = useMemo(() => (step === 3 ? picked.length > 0 : true), [step, picked]);

  return (
    <div className="space-y-5">
      <header className="rise">
        <p className="eyebrow">First run · {step + 1} of 5</p>
        <h1 className="font-display text-[28px] font-bold mt-1.5">{STEP_TITLES[step]}</h1>
        <div className="flex gap-1.5 mt-3">
          {STEP_TITLES.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-volt" : "bg-line"}`} />
          ))}
        </div>
      </header>

      {step === 0 && (
        <Card>
          <Choice label="Sex" value={sex} options={["male", "female", "other"]} onPick={(v) => setSex(v as typeof sex)} />
          <Num label="Birth year" value={birthYear} step={1} onChange={setBirthYear} />
          <Num label="Height" unit="cm" value={heightCm} step={1} onChange={setHeightCm} />
          <Choice label="Activity" value={activity} options={["sedentary", "light", "moderate", "active"]} onPick={setActivity} />
          <Num label="Current weight" unit="kg" value={currentKg} step={0.5} onChange={setCurrentKg} />

          <Toggle
            label="Add a baseline reading (optional)"
            sub="Log today's blood pressure and heart rate so your trends start from day one."
            on={addVitals}
            onToggle={() => setAddVitals((v) => !v)}
          />
          {addVitals && (
            <div className="space-y-2.5">
              <p className="text-dim text-xs">Blood pressure</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0"><NumField value={bSys} onChange={setBSys} step={1} min={50} max={260} unit="sys" compact /></div>
                <span className="text-dim text-lg">/</span>
                <div className="flex-1 min-w-0"><NumField value={bDia} onChange={setBDia} step={1} min={30} max={160} unit="dia" compact /></div>
              </div>
              <NumField label="Heart rate" value={bHr} onChange={setBHr} step={1} min={30} max={230} unit="bpm" />
            </div>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card>
          <Num label="Goal weight" unit="kg" value={goalKg} step={0.5} onChange={setGoalKg} />
          <div>
            <p className="text-dim text-xs mb-2">Weekly pace (sustainable beats fast)</p>
            <div className="grid grid-cols-4 gap-2">
              {RATE_OPTIONS.map((r) => (
                <button key={r} data-on={rate === r} onClick={() => setRate(r)} className="seg h-11 tnum text-sm">
                  {r}
                </button>
              ))}
            </div>
            <p className="text-dim text-xs mt-2.5">kg per week · your coach adjusts pace from your real data</p>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <Toggle
            label="I'm currently managing an injury"
            sub="The coach won't intensify your program until it's cleared."
            on={injury} onToggle={() => setInjury((v) => !v)}
          />
          <Toggle
            label="I have a history of disordered eating"
            sub="If so, automated calorie targets stay off — the app focuses on training, and nutrition guidance belongs with specialized professionals."
            on={edHistory} onToggle={() => setEdHistory((v) => !v)}
          />
          <p className="text-dim text-xs leading-relaxed">
            These only tune safety behavior. They&apos;re stored in your own database and shown to no one.
          </p>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <Num label="Sessions / week" value={perWeek} step={1} onChange={(v) => setPerWeek(Math.min(7, Math.max(1, v)))} />
          <div className="flex gap-2">
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Search exercises" className="field flex-1 h-11 px-3.5 text-sm outline-none"
              autoCapitalize="off" autoCorrect="off"
            />
            <button onClick={search} className="btn btn-primary px-5 text-sm">Go</button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {EQUIPMENT.map((e) => (
              <button
                key={e || "all"} onClick={() => setEquip(e)}
                className={`chip px-3 py-1.5 text-xs capitalize ${equip === e ? "border-volt text-volt bg-volt/10" : "text-dim"}`}
              >
                {e || "all"}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-line divide-y divide-line max-h-44 overflow-y-auto scroll-soft">
            {results.map((r) => (
              <button key={r.exercise_id} onClick={() => add(r)} className="w-full text-left px-3.5 py-2.5 active:bg-panel2">
                <span className="text-sm text-bone/90">{r.name}</span>
                <span className="text-dim text-xs ml-2 capitalize">{r.equipment}</span>
              </button>
            ))}
            {results.length === 0 && <p className="text-dim text-xs p-3.5">No matches — try another search.</p>}
          </div>
          {picked.length > 0 && (
            <div className="space-y-2">
              <p className="eyebrow">Your program · {picked.length}</p>
              {picked.map((p) => (
                <div key={p.exercise_id} className="field px-3.5 py-2.5 flex items-center gap-2">
                  <span className="flex-1 text-sm truncate">{p.name}</span>
                  <Mini value={p.sets} onDown={() => tweak(p.exercise_id, "sets", -1)} onUp={() => tweak(p.exercise_id, "sets", 1)} />
                  <span className="text-dim text-xs">×</span>
                  <Mini value={p.reps} onDown={() => tweak(p.exercise_id, "reps", -1)} onUp={() => tweak(p.exercise_id, "reps", 1)} />
                  <button onClick={() => remove(p.exercise_id)} className="text-alert text-xl px-1 leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {step === 4 && done && (
        <Card>
          {done.targets_disabled ? (
            <p className="text-sm text-bone/90 leading-relaxed">{done.note}</p>
          ) : (
            <>
              <p className="eyebrow mb-2">Starting point</p>
              <p className="tnum text-bone font-display text-xl font-semibold">
                {done.target?.daily_kcal} kcal · {done.target?.protein_g} g protein
              </p>
              <p className="text-dim text-xs mt-2.5 leading-relaxed">
                A conservative estimate, nothing more — your coach adjusts it from what you actually log.
                {done.rate_capped && " (Your pace was set to the safe maximum.)"}
              </p>
            </>
          )}
          <button onClick={() => router.push("/")} className="btn btn-primary w-full h-12 mt-4">
            Go to Today
          </button>
        </Card>
      )}

      {error && <p className="text-alert text-xs px-1">{error}</p>}

      {step < 4 && (
        <div className="flex gap-2.5">
          {step > 0 && (
            <button onClick={() => setStep((s) => (s - 1) as Step)} className="btn btn-ghost h-12 px-6">
              Back
            </button>
          )}
          <button
            disabled={!canNext || busy}
            onClick={() => (step === 3 ? submit() : setStep((s) => (s + 1) as Step))}
            className="btn btn-primary flex-1 h-12"
          >
            {step === 3 ? (busy ? "Saving…" : "Finish") : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------- small local pieces ------- */
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5 rise space-y-4">{children}</div>;
}
function Choice({ label, value, options, onPick }: { label: string; value: string; options: string[]; onPick: (v: string) => void }) {
  return (
    <div>
      <p className="text-dim text-xs mb-2">{label}</p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0,1fr))` }}>
        {options.map((o) => (
          <button key={o} data-on={value === o} onClick={() => onPick(o)} className="seg h-11 text-xs capitalize">
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
function Num({ label, unit, value, step, onChange }: { label: string; unit?: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-dim text-xs mb-2">{label}</p>
      <div className="field flex items-center min-w-0 overflow-hidden">
        <button className="w-11 h-12 text-2xl text-dim active:text-volt rounded-l-[0.9rem] shrink-0" onClick={() => onChange(+(value - step).toFixed(1))}>−</button>
        <div className="flex-1 min-w-0 text-center truncate">
          <span className="font-display tnum text-xl font-bold">{value}</span>
          {unit && <span className="text-dim text-xs ml-1">{unit}</span>}
        </div>
        <button className="w-11 h-12 text-2xl text-dim active:text-volt rounded-r-[0.9rem] shrink-0" onClick={() => onChange(+(value + step).toFixed(1))}>+</button>
      </div>
    </div>
  );
}
function Mini({ value, onDown, onUp }: { value: number; onDown: () => void; onUp: () => void }) {
  return (
    <span className="flex items-center rounded-lg border border-line bg-ink/40">
      <button onClick={onDown} className="w-7 h-8 text-dim active:text-volt">−</button>
      <span className="tnum text-sm w-6 text-center">{value}</span>
      <button onClick={onUp} className="w-7 h-8 text-dim active:text-volt">+</button>
    </span>
  );
}
function Toggle({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`w-full text-left field p-4 flex items-start gap-3 transition-colors ${on ? "border-volt/60" : ""}`}>
      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? "bg-volt border-volt" : "border-line"}`}>
        {on && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-onvolt)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
        )}
      </span>
      <span>
        <span className="block text-sm text-bone/90 font-medium">{label}</span>
        <span className="block text-dim text-xs mt-1 leading-relaxed">{sub}</span>
      </span>
    </button>
  );
}
