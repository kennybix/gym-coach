"use client";
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import WeightChart, { type WeightPoint } from "./WeightChart";

type Trends = {
  window_days: number;
  goal_weight_kg: number | null;
  weight_series: WeightPoint[];
  trend: {
    start_kg: number | null;
    latest_kg: number | null;
    smoothed_slope_kg_per_week: number | null;
    n_points: number;
  };
  adherence: {
    sessions_prescribed: number;
    sessions_completed: number;
    sets_prescribed: number;
    sets_completed: number;
  };
};

export default function TrendsView() {
  const [data, setData] = useState<Trends | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [weight, setWeight] = useState(80);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Trends>("/api/trends?window=30")
      .then((d) => {
        setData(d);
        setState("ok");
        if (d.trend.latest_kg) setWeight(Math.round(d.trend.latest_kg * 2) / 2);
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(load, [load]);

  const logWeight = useCallback(() => {
    void enqueue("/api/metrics/weight", {
      id: crypto.randomUUID(),
      weight_kg: weight,
      recorded_at: new Date().toISOString(),
    });
    setTimeout(load, 400); // reflect once it syncs
  }, [weight, load]);

  if (state === "unconfigured")
    return <Card><p className="text-dim text-sm">Set your token on SET-UP to see trends.</p></Card>;
  if (state === "error")
    return <Card><p className="text-dim text-sm">Can&apos;t reach the server right now. Trends will refresh when you&apos;re back online.</p></Card>;
  if (state === "loading" || !data)
    return <Card><p className="text-dim text-sm tnum">loading…</p></Card>;

  const slope = data.trend.smoothed_slope_kg_per_week;
  const direction =
    slope == null ? "—" : slope < -0.05 ? "TRENDING DOWN" : slope > 0.05 ? "TRENDING UP" : "HOLDING";
  const rate = slope == null ? null : `${Math.abs(slope).toFixed(1)} kg / wk`;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold rise">TRENDS</h1>

      {/* behavior first — the part you control */}
      <Card delay={60}>
        <p className="font-display text-[11px] tracking-[0.25em] text-dim mb-3">
          THIS BLOCK · LAST {data.window_days} DAYS
        </p>
        <Bar label="Sessions" done={data.adherence.sessions_completed} total={data.adherence.sessions_prescribed} />
        <div className="h-3" />
        <Bar label="Sets" done={data.adherence.sets_completed} total={data.adherence.sets_prescribed} />
      </Card>

      {/* weight as a trend, not a number to fixate on */}
      <Card delay={120}>
        <div className="flex items-baseline justify-between mb-2">
          <p className="font-display text-[11px] tracking-[0.25em] text-dim">WEIGHT TREND</p>
          <span className="font-display text-xs tracking-widest text-volt">
            {direction}{rate ? ` · ${rate}` : ""}
          </span>
        </div>
        <WeightChart series={data.weight_series} goalKg={data.goal_weight_kg} />
      </Card>

      {/* quick log — flows through the same offline queue as set logging */}
      <Card delay={180}>
        <p className="font-display text-[11px] tracking-[0.25em] text-dim mb-3">LOG TODAY&apos;S WEIGHT</p>
        <div className="flex items-stretch gap-2">
          <div className="flex items-center border border-line bg-panel2 flex-1">
            <button className="w-12 h-14 text-2xl text-dim active:text-volt" onClick={() => setWeight((v) => +(v - 0.5).toFixed(1))}>−</button>
            <div className="flex-1 text-center">
              <span className="font-display tnum text-2xl font-semibold">{weight.toFixed(1)}</span>
              <span className="text-dim text-xs ml-1">kg</span>
            </div>
            <button className="w-12 h-14 text-2xl text-dim active:text-volt" onClick={() => setWeight((v) => +(v + 0.5).toFixed(1))}>+</button>
          </div>
          <button onClick={logWeight} className="px-6 bg-volt text-ink font-display font-semibold tracking-wider active:bg-voltdim">
            LOG
          </button>
        </div>
      </Card>
    </div>
  );
}

function Card({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div className="bg-panel border border-line rule-volt p-4 rise" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-bone/85">{label}</span>
        <span className="tnum text-dim">
          {done}<span className="text-dim/60"> / {total || "?"}</span>
        </span>
      </div>
      <div className="h-2 bg-line">
        <div className="h-2 bg-volt" style={{ width: `${pct}%`, transition: "width 500ms ease-out" }} />
      </div>
    </div>
  );
}
