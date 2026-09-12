"use client";
/* Progress. The weight line is the hero; the week is three tiles; energy balance is one
   number with its confidence; vitals, body and photos are sections. Every log opens from "+"
   as a sheet — no form lives on this screen. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, configured } from "@/lib/api";
import { enqueue } from "@/lib/queue";
import { localDate } from "@/lib/date";
import WeightChart, { type WeightPoint } from "./WeightChart";
import NumField from "./NumField";
import VitalsSection from "./VitalsSection";
import MeasurementsCard from "./MeasurementsCard";
import ProgressPhotos from "./ProgressPhotos";
import { VitalsSheet, WeighInSheet } from "./QuickLog";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";
import PageHeader from "./ui/PageHeader";

type Trends = {
  window_days: number;
  latest_weight: { kg: number; date: string } | null;
  goal_weight_kg: number | null;
  weight_series: WeightPoint[];
  trend: { start_kg: number | null; latest_kg: number | null; smoothed_slope_kg_per_week: number | null; n_points: number; span_days: number; sufficient: boolean };
  adherence: { sessions_prescribed: number; sessions_completed: number; sets_prescribed: number; sets_completed: number };
  energy: { window_days: number; ed_history: boolean; intake_kcal_per_day: number | null; days_logged: number; maintenance_kcal_per_day: number | null; activity_kcal_total: number; weight_kg_used: number | null } | null;
  adaptive?: {
    window_days: number;
    recommendation: "disabled" | "insufficient" | "underlogged" | "cooldown" | "hold" | "adjust";
    days_logged: number; n_weighins: number; span_days: number; log_coverage: number;
    formula_maintenance_kcal: number | null; estimated_maintenance_kcal: number | null; observed_maintenance_kcal: number | null;
    confidence: "none" | "low" | "medium" | "high"; needs: string[]; reason: string;
  } | null;
};

function pretty(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function ProgressView() {
  const [data, setData] = useState<Trends | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [sheet, setSheet] = useState<null | "menu" | "weight" | "vitals">(null);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editKg, setEditKg] = useState(80);
  const [vitalsKey, setVitalsKey] = useState(0);
  const [openBody, setOpenBody] = useState(false);
  const [openPhotos, setOpenPhotos] = useState(false);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Trends>("/api/trends?window=30")
      .then((d) => { setData(d); setState("ok"); })
      .catch(() => setState((s) => (s === "ok" ? s : "error")));
  }, []);
  useEffect(load, [load]);

  const selectPoint = (date: string) => {
    const pt = data?.weight_series.find((p) => p.date === date);
    setEditKg(pt ? Math.round(pt.weight_kg * 2) / 2 : data?.trend.latest_kg ?? 80);
    setEditDate(date);
  };
  const saveEdit = () => {
    if (!editDate) return;
    void enqueue("/api/metrics/weight/set", { recorded_on: editDate, weight_kg: editKg });
    setEditDate(null);
    setTimeout(load, 500);
  };
  const removeEdit = () => {
    if (!editDate) return;
    void enqueue("/api/metrics/weight/delete", { recorded_on: editDate });
    setEditDate(null);
    setTimeout(load, 500);
  };

  const plus = (
    <button onClick={() => setSheet("menu")} aria-label="Log something" className="iconbtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );

  if (state === "unconfigured")
    return <div className="space-y-6"><PageHeader title="Progress" /><div className="card p-5"><Empty line="Paste your access token once and everything goes live." action="Open Setup" href="/settings" compact /></div></div>;
  if (state === "error")
    return <div className="space-y-6"><PageHeader title="Progress" right={plus} /><div className="card p-5"><Empty line="Can't reach the server. Progress refreshes when you're back online." compact /></div></div>;
  if (state === "loading" || !data)
    return <div className="space-y-6"><PageHeader title="Progress" right={plus} /><div className="card-lift h-64 animate-pulse" /></div>;

  const slope = data.trend.smoothed_slope_kg_per_week;
  const trustworthy = data.trend.sufficient && slope != null;
  const latest = data.trend.latest_kg ?? data.latest_weight?.kg ?? null;
  const stale = data.trend.latest_kg == null && data.latest_weight != null;
  const goal = data.goal_weight_kg;
  const toGo = latest != null && goal != null ? latest - goal : null;
  const trendLine = trustworthy
    ? `${slope! < -0.05 ? "↓" : slope! > 0.05 ? "↑" : "→"} ${Math.abs(slope!).toFixed(2)} kg/wk · ${data.trend.n_points} weigh-ins over ${data.trend.span_days} days`
    : data.trend.n_points > 0
      ? `${data.trend.n_points} weigh-in${data.trend.n_points === 1 ? "" : "s"} · trend builds after 4 across two weeks`
      : null;
  const ad = data.adaptive;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={`Last ${data.window_days} days`} title="Progress" right={plus} />

      {/* hero: weight */}
      <section className="card-lift p-5 rise" data-testid="weight-hero">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Weight</p>
            {latest != null ? (
              <p className="t-hero mt-2">{latest.toFixed(1)}<span className="text-dim text-2xl font-display font-semibold ml-1.5">kg</span></p>
            ) : (
              <p className="t-title mt-2 text-dim">No weigh-in yet</p>
            )}
          </div>
          {toGo != null && (
            <div className="text-right shrink-0">
              <p className="t-num text-xl tnum">{toGo > 0 ? `${toGo.toFixed(1)} to go` : "at goal"}</p>
              <p className="t-sec">goal {goal!.toFixed(0)} kg</p>
            </div>
          )}
        </div>
        {stale ? <p className="t-sec mt-1.5 tnum">Last weigh-in {pretty(data.latest_weight!.date)}</p> : trendLine && <p className="t-sec mt-1.5 tnum">{trendLine}</p>}
        <div className="mt-4">
          {data.weight_series.length >= 2 ? (
            <WeightChart series={data.weight_series} goalKg={goal} selectedDate={editDate} onSelect={selectPoint} />
          ) : (
            <EmptyChart />
          )}
        </div>
        {data.weight_series.length < 2 ? (
          <Empty line="Weigh in a few mornings and the trend line draws itself." action="Weigh in" onAction={() => setSheet("weight")} compact />
        ) : (
          <p className="t-sec mt-2">Tap a point to edit that weigh-in.</p>
        )}
      </section>

      {/* week tiles */}
      <section className="grid grid-cols-3 gap-2.5 rise">
        <Tile n={`${data.adherence.sessions_completed}`} label={`workout${data.adherence.sessions_completed === 1 ? "" : "s"}`} />
        <Tile n={`${data.energy?.days_logged ?? 0}/7`} label="food days" hue="food" />
        <Tile n={`${data.trend.n_points}`} label="weigh-ins" />
      </section>

      {/* energy balance */}
      {data.energy && !data.energy.ed_history && ad && ad.recommendation !== "disabled" && (
        <section className="rise" data-testid="adaptive-card">
          <p className="eyebrow mb-2">Energy balance · 28 days</p>
          {ad.observed_maintenance_kcal != null && ad.recommendation !== "underlogged" ? (
            <>
              <p className="t-num text-3xl">~{ad.estimated_maintenance_kcal}<span className="t-sec font-body font-normal ml-1.5">kcal/day maintenance · {ad.confidence} confidence</span></p>
              <p className="t-sec mt-1 tnum">{ad.days_logged} days of food · {ad.n_weighins} weigh-ins over {ad.span_days} days
                {data.energy.intake_kcal_per_day != null ? ` · eating ~${data.energy.intake_kcal_per_day}/day this week` : ""}</p>
              <p className="text-sm mt-2 leading-snug">
                {ad.recommendation === "adjust" ? "Your target is due a small calibration. The coach applies it in the weekly review."
                  : ad.recommendation === "cooldown" ? "Target changed recently. Giving it two weeks to show in the trend."
                  : "Your target lines up with what you burn. Nothing to change."}
              </p>
            </>
          ) : ad.recommendation === "underlogged" ? (
            <p className="text-sm leading-snug">Logged intake sits well below what the weight trend implies. Usually a few unlogged meals. Target unchanged.</p>
          ) : (
            <>
              <p className="t-num text-3xl text-dim">~{ad.formula_maintenance_kcal ?? data.energy.maintenance_kcal_per_day}<span className="t-sec font-body font-normal ml-1.5">kcal/day · formula estimate</span></p>
              <p className="text-sm mt-2 leading-snug">Still needed for a real number: {ad.needs.join(", ")}.</p>
            </>
          )}
        </section>
      )}

      <VitalsSection refreshKey={vitalsKey} onLog={() => setSheet("vitals")} />

      {/* body + photos as sections that expand */}
      <section className="rise">
        <button onClick={() => setOpenBody((v) => !v)} className="row" aria-expanded={openBody}>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">Body measurements</span>
            <span className="block t-sec">Waist, belly, body fat and the body map</span>
          </span>
          <span className="text-dim" style={{ transform: openBody ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
        </button>
        {openBody && <div className="mt-3"><MeasurementsCard /></div>}
        <button onClick={() => setOpenPhotos((v) => !v)} className="row" aria-expanded={openPhotos}>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">Progress photos</span>
            <span className="block t-sec">Private, dated, side by side</span>
          </span>
          <span className="text-dim" style={{ transform: openPhotos ? "rotate(90deg)" : "none", transition: "transform .2s" }}>›</span>
        </button>
        {openPhotos && <div className="mt-3"><ProgressPhotos /></div>}
      </section>

      {/* + menu */}
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title="Log">
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => setSheet("weight")} className="tile">Weigh in</button>
          <button onClick={() => setSheet("vitals")} className="tile" data-hue="vitals">Blood pressure</button>
          <button onClick={() => { setSheet(null); setOpenBody(true); }} className="tile">Measurements</button>
          <button onClick={() => { setSheet(null); setOpenPhotos(true); }} className="tile">Photo</button>
        </div>
      </Sheet>
      <WeighInSheet open={sheet === "weight"} onClose={() => setSheet(null)} latestKg={latest} onSaved={() => setTimeout(load, 500)} />
      <VitalsSheet open={sheet === "vitals"} onClose={() => setSheet(null)} onSaved={() => setTimeout(() => setVitalsKey((k) => k + 1), 500)} />

      <Sheet open={editDate != null} onClose={() => setEditDate(null)} eyebrow={editDate ? pretty(editDate) : undefined} title="Edit weigh-in">
        <NumField value={editKg} onChange={setEditKg} step={0.5} min={20} max={400} decimals={1} unit="kg" />
        <button onClick={saveEdit} className="btn btn-primary w-full h-14 mt-5 text-base">Save</button>
        {editDate && data.weight_series.some((p) => p.date === editDate) && editDate !== localDate() && (
          <button onClick={removeEdit} className="btn btn-quiet w-full h-10 mt-1 text-sm text-alert">Remove this weigh-in</button>
        )}
        {editDate && data.weight_series.some((p) => p.date === editDate) && editDate === localDate() && (
          <button onClick={removeEdit} className="btn btn-quiet w-full h-10 mt-1 text-sm text-alert">Remove today's weigh-in</button>
        )}
      </Sheet>
    </div>
  );
}

function Tile({ n, label, hue }: { n: string; label: string; hue?: "food" | "vitals" }) {
  return (
    <div className="card px-4 py-3">
      <p className="t-num text-2xl leading-none" style={hue ? { color: `var(--color-${hue})` } : undefined}>{n}</p>
      <p className="t-sec mt-1">{label}</p>
    </div>
  );
}

/* axes + a faint goal line, so the empty chart still looks like a chart */
function EmptyChart() {
  return (
    <svg viewBox="0 0 320 120" className="w-full h-auto">
      <line x1="10" y1="100" x2="310" y2="100" stroke="var(--color-line)" strokeWidth="1" />
      <line x1="10" y1="60" x2="310" y2="60" stroke="var(--color-line)" strokeWidth="1" strokeDasharray="3 4" />
      <text x="310" y="54" textAnchor="end" fontSize="9" fill="var(--color-dim)" fontFamily="var(--font-mono)">goal</text>
      {[40, 110, 180, 250].map((x) => <line key={x} x1={x} y1="98" x2={x} y2="102" stroke="var(--color-line)" />)}
    </svg>
  );
}
