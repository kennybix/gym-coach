"use client";
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import WeightChart, { type WeightPoint } from "./WeightChart";
import NumField from "./NumField";
import VitalsCard from "./VitalsCard";
import MeasurementsCard from "./MeasurementsCard";
import ProgressPhotos from "./ProgressPhotos";

type Trends = {
  window_days: number;
  goal_weight_kg: number | null;
  weight_series: WeightPoint[];
  trend: {
    start_kg: number | null;
    latest_kg: number | null;
    smoothed_slope_kg_per_week: number | null;
    n_points: number;
    span_days: number;
    sufficient: boolean;
  };
  adherence: {
    sessions_prescribed: number;
    sessions_completed: number;
    sets_prescribed: number;
    sets_completed: number;
  };
  energy: {
    window_days: number;
    ed_history: boolean;
    intake_kcal_per_day: number | null;
    days_logged: number;
    maintenance_kcal_per_day: number | null;
    activity_kcal_total: number;
    weight_kg_used: number | null;
  } | null;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function pretty(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function TrendsView() {
  const [data, setData] = useState<Trends | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [selected, setSelected] = useState(todayISO());
  const [weight, setWeight] = useState(80);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Trends>("/api/trends?window=30")
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  // prefill the editor from the selected day's point (or latest weight as a sensible default)
  useEffect(() => {
    if (!data) return;
    const pt = data.weight_series.find((p) => p.date === selected);
    if (pt) setWeight(Math.round(pt.weight_kg * 2) / 2);
    else if (selected === todayISO() && data.trend.latest_kg) setWeight(Math.round(data.trend.latest_kg * 2) / 2);
  }, [selected, data]);

  const saveWeight = useCallback(() => {
    void enqueue("/api/metrics/weight/set", { recorded_on: selected, weight_kg: weight });
    setTimeout(load, 400);
  }, [weight, selected, load]);

  const removeWeight = useCallback(() => {
    void enqueue("/api/metrics/weight/delete", { recorded_on: selected });
    setSelected(todayISO());
    setTimeout(load, 400);
  }, [selected, load]);

  if (state === "unconfigured")
    return <Wrap><Card><p className="text-dim text-sm">Set your token on Setup to see trends.</p></Card></Wrap>;
  if (state === "error")
    return <Wrap><Card><p className="text-dim text-sm leading-relaxed">Can&apos;t reach the server right now. Trends will refresh when you&apos;re back online.</p></Card></Wrap>;
  if (state === "loading" || !data)
    return <Wrap><div className="card p-5 h-40 animate-pulse" /></Wrap>;

  const slope = data.trend.smoothed_slope_kg_per_week;
  // Only show a direction + weekly rate once there's enough data; a couple of weigh-ins
  // can imply absurd rates (e.g. "15.9 kg/wk"). Until then, show calmer "building" copy.
  const trustworthy = data.trend.sufficient && slope != null;
  const dir =
    !trustworthy ? { label: "Building trend", tone: "text-dim" }
    : slope! < -0.05 ? { label: "Trending down", tone: "text-volt" }
    : slope! > 0.05 ? { label: "Trending up", tone: "text-alert" }
    : { label: "Holding", tone: "text-dim" };
  const rate = trustworthy ? `${Math.abs(slope!).toFixed(1)} kg/wk · ${data.trend.span_days}d` : null;

  const isToday = selected === todayISO();
  const hasEntry = data.weight_series.some((p) => p.date === selected);

  return (
    <Wrap>
      <Card delay={60}>
        <p className="eyebrow mb-3">This block · last {data.window_days} days</p>
        <Bar label="Sessions" done={data.adherence.sessions_completed} total={data.adherence.sessions_prescribed} />
        <div className="h-4" />
        <Bar label="Sets" done={data.adherence.sets_completed} total={data.adherence.sets_prescribed} />
      </Card>

      <Card delay={120}>
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">Weight trend</p>
          <span className={`chip px-2.5 py-1 text-xs font-semibold ${dir.tone}`}>
            {dir.label}{rate ? ` · ${rate}` : ""}
          </span>
        </div>
        <WeightChart series={data.weight_series} goalKg={data.goal_weight_kg} selectedDate={selected} onSelect={setSelected} />
        <p className="text-dim text-xs mt-2 text-center">
          {trustworthy
            ? "Tap a point on the line to edit or remove that weigh-in."
            : "A few more weigh-ins over 2+ weeks and I'll show a reliable rate. Tap a point to edit it."}
        </p>
      </Card>

      {data.energy && !data.energy.ed_history && data.energy.maintenance_kcal_per_day != null && (
        <Card delay={150}>
          <p className="eyebrow mb-3">Energy this week · estimates</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-dim text-xs">Food in</p>
              <p className="font-display tnum text-2xl font-bold mt-0.5">
                {data.energy.intake_kcal_per_day != null ? `~${data.energy.intake_kcal_per_day}` : "—"}
              </p>
              <p className="text-dim text-[11px]">kcal/day · {data.energy.days_logged} of 7 days</p>
            </div>
            <div>
              <p className="text-dim text-xs">Maintenance</p>
              <p className="font-display tnum text-2xl font-bold mt-0.5">~{data.energy.maintenance_kcal_per_day}</p>
              <p className="text-dim text-[11px]">kcal/day · resting + activity</p>
            </div>
          </div>
          {data.energy.activity_kcal_total > 0 && (
            <p className="text-dim text-xs mt-3">Logged workouts this week: ~{data.energy.activity_kcal_total} kcal burned.</p>
          )}
          <p className="text-dim text-xs mt-2 leading-relaxed">
            Rough estimates — your <span className="text-bone/80">weight trend above</span> is the real
            measure of whether things balance out.
          </p>
        </Card>
      )}

      <Card delay={180}>
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">{isToday ? "Log today's weight" : `Edit ${pretty(selected)}`}</p>
          {!isToday && (
            <button onClick={() => setSelected(todayISO())} className="text-xs text-volt font-medium">Back to today</button>
          )}
        </div>
        <div className="flex items-stretch gap-2.5">
          <div className="flex-1 min-w-0">
            <NumField value={weight} onChange={setWeight} step={0.5} min={0} max={500} decimals={1} unit="kg" />
          </div>
          <button onClick={saveWeight} className="btn btn-primary px-7">Save</button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-dim text-xs">Tap the number to type it in, or use −/+ for 0.5 kg steps.</p>
          {hasEntry && (
            <button onClick={removeWeight} className="text-xs text-alert font-medium shrink-0 ml-3">Remove</button>
          )}
        </div>

        {data.weight_series.length > 0 && (
          <>
            <p className="text-dim text-xs mt-4 mb-1">Your weigh-ins — tap one to edit or remove it:</p>
            <ul className="divide-y divide-line">
              {[...data.weight_series].reverse().slice(0, 8).map((p) => (
                <li key={p.date}>
                  <button
                    onClick={() => setSelected(p.date)}
                    className={`w-full py-2 flex items-baseline justify-between gap-3 text-sm ${p.date === selected ? "text-volt" : "text-bone/90"}`}
                  >
                    <span className="tnum font-medium">{p.weight_kg} kg</span>
                    <span className="text-dim text-xs">{pretty(p.date)}{p.date === selected ? " · editing" : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <VitalsCard delay={240} />

      <MeasurementsCard delay={300} />

      <ProgressPhotos delay={360} />
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-bold rise">Trends</h1>
      {children}
    </div>
  );
}
function Card({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return <div className="card p-5 rise" style={{ animationDelay: `${delay}ms` }}>{children}</div>;
}
function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between items-baseline text-sm mb-2">
        <span className="text-bone/90 font-medium">{label}</span>
        <span className="tnum text-dim">
          <span className="text-bone font-semibold">{done}</span> / {total || "?"}
        </span>
      </div>
      <div className="h-2.5 bg-line rounded-full overflow-hidden">
        <div className="h-full bg-volt rounded-full" style={{ width: `${pct}%`, transition: "width 600ms cubic-bezier(0.2,0.7,0.2,1)" }} />
      </div>
    </div>
  );
}
