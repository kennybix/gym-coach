"use client";
/* The "Fuel" tab. Deliberate wellbeing-aware design: the hero is logging CONSISTENCY
 * (a controllable behavior), not the calorie number. Figures are present but quiet,
 * the target is the coach-set value shown without over/under alarms, and the UI never
 * suggests a target of its own. Writes flow through the same offline queue. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";

type Nutrition = {
  window_days: number;
  days_logged: number;
  avg_kcal: number | null;
  target_kcal: number | null;
  avg_protein_g: number | null;
  series: { date: string; kcal: number | null; protein_g: number | null }[];
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function NutritionView() {
  const [data, setData] = useState<Nutrition | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [kcal, setKcal] = useState(2000);
  const [protein, setProtein] = useState(140);
  const [savedTick, setSavedTick] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Nutrition>("/api/nutrition?window=14")
      .then((d) => {
        setData(d);
        setState("ok");
        const today = d.series.find((s) => s.date === todayISO());
        if (today?.kcal) setKcal(today.kcal);
        if (today?.protein_g) setProtein(Math.round(today.protein_g));
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  const save = useCallback(() => {
    void enqueue("/api/nutrition", { logged_on: todayISO(), kcal, protein_g: protein });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    setTimeout(load, 400);
  }, [kcal, protein, load]);

  const strip = useMemo(() => {
    if (!data) return [];
    const logged = new Set(data.series.filter((s) => s.kcal != null).map((s) => s.date));
    const days: { date: string; on: boolean }[] = [];
    for (let i = data.window_days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      days.push({ date: iso, on: logged.has(iso) });
    }
    return days;
  }, [data]);

  if (state === "unconfigured")
    return <Wrap><Card><p className="text-dim text-sm">Set your token on SET-UP to log fuel.</p></Card></Wrap>;
  if (state === "error")
    return <Wrap><Card><p className="text-dim text-sm">Can&apos;t reach the server right now — entries will sync when you&apos;re back online.</p></Card></Wrap>;
  if (state === "loading" || !data)
    return <Wrap><Card><p className="text-dim text-sm tnum">loading…</p></Card></Wrap>;

  return (
    <Wrap>
      {/* hero: consistency, the part you control */}
      <Card delay={60}>
        <div className="flex items-baseline justify-between mb-3">
          <p className="font-display text-[11px] tracking-[0.25em] text-dim">LOGGING STREAK</p>
          <span className="font-display tnum text-sm text-volt">
            {data.days_logged}<span className="text-dim"> / {data.window_days} days</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {strip.map((d) => (
            <span key={d.date} className={`w-3.5 h-3.5 ${d.on ? "bg-volt" : "bg-line"}`} title={d.date} />
          ))}
        </div>
      </Card>

      {/* today's entry — neutral, no targets suggested here */}
      <Card delay={120}>
        <p className="font-display text-[11px] tracking-[0.25em] text-dim mb-3">LOG TODAY</p>
        <div className="space-y-2">
          <Stepper label="energy" unit="kcal" value={kcal} step={50} min={0} onChange={setKcal} />
          <Stepper label="protein" unit="g" value={protein} step={5} min={0} onChange={setProtein} />
        </div>
        <button onClick={save} className="mt-3 w-full h-12 bg-volt text-ink font-display font-semibold tracking-[0.2em] active:bg-voltdim">
          {savedTick ? "SAVED" : "SAVE TODAY"}
        </button>
      </Card>

      {/* context, kept quiet: this week vs the coach-set target, no over/under verdict */}
      <Card delay={180}>
        <p className="font-display text-[11px] tracking-[0.25em] text-dim mb-3">THIS WEEK · CONTEXT</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Quiet label="avg energy" value={data.avg_kcal != null ? `${Math.round(data.avg_kcal)} kcal` : "—"} />
          <Quiet label="target" value={data.target_kcal != null ? `${data.target_kcal} kcal` : "not set"} />
          <Quiet label="avg protein" value={data.avg_protein_g != null ? `${Math.round(data.avg_protein_g)} g` : "—"} />
        </div>
        <p className="text-dim/70 text-xs mt-3 leading-relaxed">
          Targets come from your coach, not this screen. Consistency matters more than any single day.
        </p>
      </Card>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">FUEL</h1>
      {children}
    </div>
  );
}
function Card({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return <div className="bg-panel border border-line rule-volt p-4 rise" style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}
function Quiet({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-dim text-xs">{label}</p>
      <p className="tnum text-bone/90 mt-0.5">{value}</p>
    </div>
  );
}
function Stepper({
  label, unit, value, step, min, onChange,
}: { label: string; unit: string; value: number; step: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center border border-line bg-panel2">
      <span className="pl-3 text-dim text-xs w-16">{label}</span>
      <button className="w-11 h-12 text-2xl text-dim active:text-volt" onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <div className="flex-1 text-center">
        <span className="font-display tnum text-xl font-semibold">{value}</span>
        <span className="text-dim text-xs ml-1">{unit}</span>
      </div>
      <button className="w-11 h-12 text-2xl text-dim active:text-volt" onClick={() => onChange(value + step)}>+</button>
    </div>
  );
}
