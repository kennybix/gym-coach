"use client";
/* The "Fuel" tab. Deliberate wellbeing-aware design: the hero is logging CONSISTENCY
 * (a controllable behavior), not the calorie number. Figures are present but quiet,
 * the target is the coach-set value shown without over/under alarms, and the UI never
 * suggests a target of its own. Writes flow through the same offline queue.
 * You can edit ANY day: tap a square in the streak to load + edit that day's entry. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import { localDate } from "@/lib/date";
import NumField from "./NumField";
import FoodLog from "./FoodLog";

type DayRow = { date: string; kcal: number | null; protein_g: number | null };
type Nutrition = {
  window_days: number;
  days_logged: number;
  avg_kcal: number | null;
  target_kcal: number | null;
  avg_protein_g: number | null;
  target_protein_g: number | null;
  series: DayRow[];
};

function todayISO() {
  return localDate();
}
function pretty(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function NutritionView() {
  const [data, setData] = useState<Nutrition | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [selected, setSelected] = useState(todayISO());
  const [kcal, setKcal] = useState(2000);
  const [protein, setProtein] = useState(140);
  const [savedTick, setSavedTick] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Nutrition>("/api/nutrition?window=14")
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  // when the selected day (or freshly-loaded data) changes, prefill from that day's entry
  useEffect(() => {
    if (!data) return;
    const row = data.series.find((s) => s.date === selected);
    if (row?.kcal != null) setKcal(row.kcal);
    if (row?.protein_g != null) setProtein(Math.round(row.protein_g));
  }, [selected, data]);

  const save = useCallback(() => {
    void enqueue("/api/nutrition", { logged_on: selected, kcal, protein_g: protein });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1400);
    setTimeout(load, 400);
  }, [kcal, protein, selected, load]);

  const strip = useMemo(() => {
    if (!data) return [];
    const logged = new Set(data.series.filter((s) => s.kcal != null).map((s) => s.date));
    const days: { date: string; on: boolean }[] = [];
    for (let i = data.window_days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = localDate(d);
      days.push({ date: iso, on: logged.has(iso) });
    }
    return days;
  }, [data]);

  if (state === "unconfigured")
    return <Wrap><Card><p className="text-dim text-sm">Set your token on Setup to log fuel.</p></Card></Wrap>;
  if (state === "error")
    return <Wrap><Card><p className="text-dim text-sm leading-relaxed">Can&apos;t reach the server right now — entries will sync when you&apos;re back online.</p></Card></Wrap>;
  if (state === "loading" || !data)
    return <Wrap><div className="card p-5 h-32 animate-pulse" /></Wrap>;

  const isToday = selected === todayISO();
  const dayRow = data.series.find((s) => s.date === selected);
  const dayKcal = dayRow?.kcal ?? 0;
  const dayProtein = dayRow?.protein_g != null ? Math.round(dayRow.protein_g) : 0;
  const proteinTarget = data.target_protein_g;
  const proteinPct = proteinTarget ? Math.min(100, Math.round((dayProtein / proteinTarget) * 100)) : 0;

  return (
    <Wrap>
      {/* hero: consistency. Tap a day to edit it. */}
      <Card delay={60}>
        <div className="flex items-baseline justify-between mb-3.5">
          <p className="eyebrow">Logging streak</p>
          <span className="tnum text-sm text-dim">
            <span className="text-volt font-semibold">{data.days_logged}</span> / {data.window_days} days
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {strip.map((d) => (
            <button
              key={d.date}
              onClick={() => setSelected(d.date)}
              title={pretty(d.date)}
              aria-label={`edit ${pretty(d.date)}`}
              className={`w-5 h-5 rounded-md transition-transform active:scale-90 ${
                d.on ? "bg-volt" : "bg-panel2 border border-line"
              } ${d.date === selected ? "ring-2 ring-bone ring-offset-2 ring-offset-panel" : ""}`}
            />
          ))}
        </div>
        <p className="text-dim text-xs mt-3">Tap any day to view or edit its entry.</p>
      </Card>

      {/* food-database logging — the primary path; recomputes the day total */}
      <FoodLog date={selected} onChange={load} />

      {/* macro summary — protein as a goal to reach; calories shown without verdicts */}
      <Card delay={140}>
        <p className="eyebrow mb-3.5">{isToday ? "Today" : pretty(selected)} · totals</p>
        <div className="flex justify-between items-baseline text-sm mb-1.5">
          <span className="text-bone/90 font-medium">Protein</span>
          <span className="tnum text-dim">
            <span className="text-bone font-semibold">{dayProtein}</span>{proteinTarget ? ` / ${proteinTarget}` : ""} g
          </span>
        </div>
        {proteinTarget ? (
          <div className="h-2.5 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-volt rounded-full" style={{ width: `${proteinPct}%`, transition: "width 500ms cubic-bezier(0.2,0.7,0.2,1)" }} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-between items-baseline text-sm">
          <span className="text-bone/90 font-medium">Energy</span>
          <span className="tnum text-dim">
            <span className="text-bone font-semibold">{dayKcal}</span> kcal{data.target_kcal ? ` · target ${data.target_kcal}` : ""}
          </span>
        </div>
        <p className="text-dim text-xs mt-3 leading-relaxed">
          Protein is a goal to reach; calories are shown plainly, without any over/under judgment. Consistency beats any single day.
        </p>
      </Card>

      {/* manual total — for a quick day without itemizing */}
      <Card delay={120}>
        <div className="flex items-center justify-between mb-3.5">
          <p className="eyebrow">{isToday ? "Or log a total manually" : `Edit ${pretty(selected)} total`}</p>
          {!isToday && (
            <button onClick={() => setSelected(todayISO())} className="text-xs text-volt font-medium">
              Back to today
            </button>
          )}
        </div>
        <div className="space-y-2.5">
          <NumField label="Energy" unit="kcal" value={kcal} step={50} min={0} max={20000} onChange={setKcal} />
          <NumField label="Protein" unit="g" value={protein} step={5} min={0} max={1000} onChange={setProtein} />
        </div>
        <button onClick={save} className="btn btn-primary w-full h-12 mt-4">
          {savedTick ? "Saved ✓" : isToday ? "Save today" : `Save ${pretty(selected)}`}
        </button>
      </Card>

      {/* context, kept quiet */}
      <Card delay={180}>
        <p className="eyebrow mb-3.5">This week · context</p>
        <div className="grid grid-cols-3 gap-3">
          <Quiet label="Avg energy" value={data.avg_kcal != null ? `${Math.round(data.avg_kcal)}` : "—"} unit="kcal" />
          <Quiet label="Target" value={data.target_kcal != null ? `${data.target_kcal}` : "—"} unit={data.target_kcal != null ? "kcal" : ""} />
          <Quiet label="Avg protein" value={data.avg_protein_g != null ? `${Math.round(data.avg_protein_g)}` : "—"} unit="g" />
        </div>
        <p className="text-dim text-xs mt-4 leading-relaxed">
          Targets come from your coach, not this screen. Consistency matters more than any single day.
        </p>
      </Card>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-bold rise">Fuel</h1>
      {children}
    </div>
  );
}
function Card({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}
function Quiet({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-dim text-xs">{label}</p>
      <p className="mt-1">
        <span className="tnum text-bone font-display font-semibold text-lg">{value}</span>
        {unit && <span className="text-dim text-xs ml-1">{unit}</span>}
      </p>
    </div>
  );
}
