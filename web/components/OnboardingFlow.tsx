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

type Step = 0 | 1 | 2 | 3 | 4;
type CatalogRow = { exercise_id: string; name: string; equipment: string; primary_muscles: string[] };
type Picked = CatalogRow & { sets: number; reps: number };

const RATE_OPTIONS = [0.25, 0.5, 0.75, 1.0]; // kg/week — capped list by design
const EQUIPMENT = ["", "none", "dumbbell", "barbell", "kettlebell", "band", "cable", "machine"];

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
    <div className="space-y-4">
      <header className="rise">
        <p className="font-display text-[11px] tracking-[0.3em] text-dim">FIRST RUN · {step + 1}/5</p>
        <h1 className="font-display text-3xl font-semibold mt-1">
          {["ABOUT YOU", "YOUR GOAL", "SCREENING", "YOUR PROGRAM", "READY"][step]}
        </h1>
      </header>

      {step === 0 && (
        <Card>
          <Choice label="sex" value={sex} options={["male", "female", "other"]} onPick={(v) => setSex(v as typeof sex)} />
          <Num label="birth year" value={birthYear} step={1} onChange={setBirthYear} />
          <Num label="height" unit="cm" value={heightCm} step={1} onChange={setHeightCm} />
          <Choice label="activity" value={activity} options={["sedentary", "light", "moderate", "active"]} onPick={setActivity} />
          <Num label="current weight" unit="kg" value={currentKg} step={0.5} onChange={setCurrentKg} />
        </Card>
      )}

      {step === 1 && (
        <Card>
          <Num label="goal weight" unit="kg" value={goalKg} step={0.5} onChange={setGoalKg} />
          <div className="mt-3">
            <p className="text-dim text-xs mb-2">weekly pace (sustainable beats fast)</p>
            <div className="grid grid-cols-4 gap-2">
              {RATE_OPTIONS.map((r) => (
                <button key={r} onClick={() => setRate(r)}
                  className={`h-11 font-display tnum text-sm border ${rate === r ? "bg-volt text-ink border-volt font-semibold" : "border-line text-bone/80"}`}>
                  {r}
                </button>
              ))}
            </div>
            <p className="text-dim/70 text-xs mt-2">kg per week · your coach adjusts pace from your real data</p>
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
          <div className="h-3" />
          <Toggle
            label="I have a history of disordered eating"
            sub="If so, automated calorie targets stay off — the app focuses on training, and nutrition guidance belongs with specialized professionals."
            on={edHistory} onToggle={() => setEdHistory((v) => !v)}
          />
          <p className="text-dim/70 text-xs mt-4 leading-relaxed">
            These only tune safety behavior. They&apos;re stored in your own database and shown to no one.
          </p>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <Num label="sessions / week" value={perWeek} step={1} onChange={(v) => setPerWeek(Math.min(7, Math.max(1, v)))} />
          <div className="flex gap-2 mt-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="search exercises" className="flex-1 h-11 bg-panel2 border border-line px-3 text-sm outline-none focus:border-volt" />
            <button onClick={search} className="px-4 bg-volt text-ink font-display text-sm font-semibold tracking-wider active:bg-voltdim">GO</button>
          </div>
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {EQUIPMENT.map((e) => (
              <button key={e || "all"} onClick={() => setEquip(e)}
                className={`px-2.5 py-1 text-[10px] font-display tracking-widest border ${equip === e ? "border-volt text-volt" : "border-line text-dim"}`}>
                {(e || "all").toUpperCase()}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-44 overflow-y-auto divide-y divide-line border border-line">
            {results.map((r) => (
              <button key={r.exercise_id} onClick={() => add(r)} className="w-full text-left px-3 py-2.5 active:bg-panel2">
                <span className="text-sm text-bone/90">{r.name}</span>
                <span className="text-dim text-xs ml-2">{r.equipment}</span>
              </button>
            ))}
            {results.length === 0 && <p className="text-dim text-xs p-3">no matches — try another search</p>}
          </div>
          {picked.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="font-display text-[11px] tracking-[0.25em] text-dim">YOUR PROGRAM · {picked.length}</p>
              {picked.map((p) => (
                <div key={p.exercise_id} className="border border-line bg-panel2 px-3 py-2 flex items-center gap-2">
                  <span className="flex-1 text-sm truncate">{p.name}</span>
                  <Mini value={p.sets} onDown={() => tweak(p.exercise_id, "sets", -1)} onUp={() => tweak(p.exercise_id, "sets", 1)} />
                  <span className="text-dim text-xs">×</span>
                  <Mini value={p.reps} onDown={() => tweak(p.exercise_id, "reps", -1)} onUp={() => tweak(p.exercise_id, "reps", 1)} />
                  <button onClick={() => remove(p.exercise_id)} className="text-alert text-lg px-1">×</button>
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
              <p className="font-display text-[11px] tracking-[0.25em] text-dim mb-2">STARTING POINT</p>
              <p className="tnum text-bone/90 text-sm">
                {done.target?.daily_kcal} kcal · {done.target?.protein_g} g protein
              </p>
              <p className="text-dim/80 text-xs mt-2 leading-relaxed">
                A conservative estimate, nothing more — your coach adjusts it from what you actually log.
                {done.rate_capped && " (Your pace was set to the safe maximum.)"}
              </p>
            </>
          )}
          <button onClick={() => router.push("/")} className="mt-4 w-full h-12 bg-volt text-ink font-display font-semibold tracking-[0.2em] active:bg-voltdim">
            GO TO TODAY
          </button>
        </Card>
      )}

      {error && <p className="text-alert text-xs px-1">{error}</p>}

      {step < 4 && (
        <div className="flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep((s) => (s - 1) as Step)} className="h-12 px-5 border border-line text-bone font-display tracking-widest active:bg-panel">
              BACK
            </button>
          )}
          <button
            disabled={!canNext || busy}
            onClick={() => (step === 3 ? submit() : setStep((s) => (s + 1) as Step))}
            className="flex-1 h-12 bg-volt text-ink font-display font-semibold tracking-[0.2em] active:bg-voltdim disabled:opacity-40"
          >
            {step === 3 ? (busy ? "SAVING…" : "FINISH") : "NEXT"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------- small local pieces ------- */
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-panel border border-line rule-volt p-4 rise space-y-3">{children}</div>;
}
function Choice({ label, value, options, onPick }: { label: string; value: string; options: string[]; onPick: (v: string) => void }) {
  return (
    <div>
      <p className="text-dim text-xs mb-1.5">{label}</p>
      <div className={`grid grid-cols-${Math.min(options.length, 4)} gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0,1fr))` }}>
        {options.map((o) => (
          <button key={o} onClick={() => onPick(o)}
            className={`h-11 text-xs font-display tracking-wider border ${value === o ? "bg-volt text-ink border-volt font-semibold" : "border-line text-bone/80"}`}>
            {o.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
function Num({ label, unit, value, step, onChange }: { label: string; unit?: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-dim text-xs mb-1.5">{label}</p>
      <div className="flex items-center border border-line bg-panel2">
        <button className="w-11 h-12 text-2xl text-dim active:text-volt" onClick={() => onChange(+(value - step).toFixed(1))}>−</button>
        <div className="flex-1 text-center">
          <span className="font-display tnum text-xl font-semibold">{value}</span>
          {unit && <span className="text-dim text-xs ml-1">{unit}</span>}
        </div>
        <button className="w-11 h-12 text-2xl text-dim active:text-volt" onClick={() => onChange(+(value + step).toFixed(1))}>+</button>
      </div>
    </div>
  );
}
function Mini({ value, onDown, onUp }: { value: number; onDown: () => void; onUp: () => void }) {
  return (
    <span className="flex items-center border border-line">
      <button onClick={onDown} className="w-7 h-8 text-dim active:text-volt">−</button>
      <span className="tnum text-sm w-6 text-center">{value}</span>
      <button onClick={onUp} className="w-7 h-8 text-dim active:text-volt">+</button>
    </span>
  );
}
function Toggle({ label, sub, on, onToggle }: { label: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full text-left border border-line bg-panel2 p-3 flex items-start gap-3 active:border-volt/50">
      <span className={`mt-0.5 w-5 h-5 shrink-0 border ${on ? "bg-volt border-volt" : "border-line"}`} />
      <span>
        <span className="block text-sm text-bone/90">{label}</span>
        <span className="block text-dim text-xs mt-1 leading-relaxed">{sub}</span>
      </span>
    </button>
  );
}
