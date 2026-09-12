"use client";
/* Food. Today's meals first, a protein ring as the goal, calories shown plainly (no verdicts —
   the wellbeing framing is deliberate), a 7-day logging strip, and a "+" that opens the add
   sheet. Tap a day dot to view/edit that day. `?add=1` opens the sheet on arrival (Home tile). */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPost, configured } from "@/lib/api";
import { localDate } from "@/lib/date";
import FoodAddSheet from "./FoodAddSheet";
import Ring from "./ui/Ring";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";
import PageHeader from "./ui/PageHeader";

type DayRow = { date: string; kcal: number | null; protein_g: number | null };
type Nutrition = { window_days: number; days_logged: number; avg_kcal: number | null; target_kcal: number | null; avg_protein_g: number | null; target_protein_g: number | null; series: DayRow[] };
type Entry = { id: string; name: string; brand: string | null; grams: number | null; kcal: number; protein_g: number | null; carbs_g?: number | null; fat_g?: number | null; fiber_g?: number | null };

function pretty(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function FoodView() {
  return (
    <Suspense fallback={<div className="card-lift h-48 animate-pulse" />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const [data, setData] = useState<Nutrition | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [selected, setSelected] = useState(localDate());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [saveMeal, setSaveMeal] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    apiGet<Nutrition>("/api/nutrition?window=14")
      .then((d) => { setData(d); setState("ok"); })
      .catch(() => setState((s) => (s === "ok" ? s : "error")));
  }, []);
  const loadEntries = useCallback((date: string) => {
    apiGet<{ foods: Entry[] }>(`/api/foods?date=${date}`).then((d) => setEntries(d.foods)).catch(() => setEntries([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { loadEntries(selected); }, [selected, loadEntries]);
  useEffect(() => { if (params.get("add") === "1") setAdd(true); }, [params]);

  const refresh = useCallback(() => { load(); loadEntries(selected); }, [load, loadEntries, selected]);

  const remove = async (e: Entry) => {
    setEntries((p) => p.filter((x) => x.id !== e.id));
    setEditing(null);
    await apiPost("/api/foods/delete", { id: e.id, logged_on: selected });
    refresh();
  };
  const doSaveMeal = async () => {
    const name = (saveMeal || "").trim();
    if (!name || entries.length === 0) return;
    await apiPost("/api/meals", { name, items: entries.map((e) => ({ name: e.name, brand: e.brand, grams: e.grams, kcal: e.kcal, protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g })) });
    setSaveMeal(null);
  };

  const strip = useMemo(() => {
    const logged = new Set((data?.series ?? []).filter((s) => s.kcal != null).map((s) => s.date));
    const days: { date: string; on: boolean; label: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = localDate(d);
      days.push({ date: iso, on: logged.has(iso), label: d.toLocaleDateString(undefined, { weekday: "narrow" }) });
    }
    return days;
  }, [data]);

  const plus = (
    <button onClick={() => setAdd(true)} aria-label="Add food" className="iconbtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  );

  if (state === "unconfigured")
    return <div className="space-y-6"><PageHeader title="Food" /><div className="card p-5"><Empty line="Paste your access token once and everything goes live." action="Open Setup" href="/settings" compact /></div></div>;
  if (state === "error")
    return <div className="space-y-6"><PageHeader title="Food" right={plus} /><div className="card p-5"><Empty line="Can't reach the server. Entries sync when you're back online." compact /></div></div>;
  if (state === "loading" || !data)
    return <div className="space-y-6"><PageHeader title="Food" right={plus} /><div className="card-lift h-48 animate-pulse" /></div>;

  const isToday = selected === localDate();
  const row = data.series.find((s) => s.date === selected);
  const dayKcal = entries.length ? entries.reduce((t, e) => t + e.kcal, 0) : row?.kcal ?? 0;
  const dayProtein = entries.length ? Math.round(entries.reduce((t, e) => t + (e.protein_g ?? 0), 0)) : row?.protein_g != null ? Math.round(row.protein_g) : 0;
  const pTarget = data.target_protein_g;
  const loggedThisWeek = strip.filter((d) => d.on).length;

  return (
    <div className="space-y-7">
      <PageHeader eyebrow={isToday ? "Today" : pretty(selected)} title="Food" right={plus} />

      <section className="card-lift p-5 rise" data-testid="food-hero">
        <div className="flex items-center gap-5">
          <Ring value={pTarget ? dayProtein / pTarget : 0} size={92} stroke={8} color="var(--color-food)">
            <div className="text-center leading-none">
              <p className="t-num text-2xl">{dayProtein}</p>
              <p className="t-sec font-mono mt-0.5">g</p>
            </div>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Protein</p>
            <p className="t-h2 mt-1 tnum">{pTarget ? `${dayProtein} of ${pTarget} g` : `${dayProtein} g`}</p>
            <p className="t-sec mt-2 tnum">{dayKcal.toLocaleString()} kcal{data.target_kcal ? ` · target ${data.target_kcal.toLocaleString()}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 mt-5">
          <div className="flex gap-1.5 min-w-0">
            {strip.map((d) => (
              <button key={d.date} onClick={() => setSelected(d.date)} aria-label={pretty(d.date)}
                className={`w-8 h-8 rounded-full text-[11px] font-mono flex items-center justify-center border transition-transform active:scale-90 ${d.on ? "bg-volt text-onvolt border-volt" : "border-line text-dim"} ${d.date === selected ? "ring-2 ring-bone/70 ring-offset-2 ring-offset-lift" : ""}`}>
                {d.label}
              </button>
            ))}
          </div>
          <p className="t-sec tnum shrink-0">{loggedThisWeek}/7 days</p>
        </div>
      </section>

      <section className="rise">
        <div className="flex items-baseline justify-between mb-1">
          <p className="eyebrow">{isToday ? "Today's food" : pretty(selected)}</p>
          {!isToday && <button onClick={() => setSelected(localDate())} className="text-xs font-mono text-volt">Back to today</button>}
        </div>
        {entries.length === 0 ? (
          <Empty line={row?.kcal != null ? `Logged as a day total: ${row.kcal} kcal.` : "Nothing logged yet."} action="Add food" onAction={() => setAdd(true)} />
        ) : (
          <div>
            {entries.map((e) => (
              <button key={e.id} onClick={() => setEditing(e)} className="row">
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[15px]">{e.name}{e.brand && <span className="t-sec ml-2">{e.brand}</span>}</span>
                  <span className="block t-sec tnum">{e.grams ? `${e.grams} g · ` : ""}{e.kcal} kcal · {Math.round(e.protein_g ?? 0)} g protein</span>
                </span>
                <span className="text-dim">›</span>
              </button>
            ))}
            <div className="flex gap-2 mt-3">
              <button onClick={() => setAdd(true)} className="btn btn-ghost h-11 flex-1 text-sm">+ Add more</button>
              <button onClick={() => setSaveMeal("")} className="btn btn-quiet h-11 px-3 text-xs">Save as a meal</button>
            </div>
          </div>
        )}
      </section>

      <section className="rise">
        <p className="eyebrow mb-1">Last 14 days</p>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="card px-4 py-3"><p className="t-num text-2xl leading-none">{data.days_logged}</p><p className="t-sec mt-1">days logged</p></div>
          <div className="card px-4 py-3"><p className="t-num text-2xl leading-none">{data.avg_protein_g != null ? Math.round(data.avg_protein_g) : "–"}</p><p className="t-sec mt-1">avg protein g</p></div>
          <div className="card px-4 py-3"><p className="t-num text-2xl leading-none">{data.avg_kcal != null ? Math.round(data.avg_kcal).toLocaleString() : "–"}</p><p className="t-sec mt-1">avg kcal</p></div>
        </div>
        <p className="t-sec mt-3 leading-snug">Protein is a goal to reach. Calories are shown plainly, with no over/under verdicts. Targets come from your coach.</p>
      </section>

      <FoodAddSheet open={add} onClose={() => setAdd(false)} date={selected} onAdded={refresh} />

      <Sheet open={editing != null} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <>
            <p className="t-sec tnum">{editing.grams ? `${editing.grams} g · ` : ""}{editing.kcal} kcal · P {Math.round(editing.protein_g ?? 0)}{editing.carbs_g != null ? ` · C ${Math.round(editing.carbs_g)}` : ""}{editing.fat_g != null ? ` · F ${Math.round(editing.fat_g)}` : ""} g</p>
            <button onClick={() => remove(editing)} className="btn btn-ghost w-full h-12 mt-4 text-alert">Remove from this day</button>
          </>
        )}
      </Sheet>

      <Sheet open={saveMeal != null} onClose={() => setSaveMeal(null)} eyebrow={`${entries.length} items · ${dayKcal} kcal`} title="Save as a meal">
        <input value={saveMeal ?? ""} onChange={(e) => setSaveMeal(e.target.value)} placeholder="Meal name, e.g. Usual breakfast" className="field w-full h-12 px-4 text-[15px] outline-none" autoFocus />
        <button onClick={doSaveMeal} disabled={!(saveMeal || "").trim()} className="btn btn-primary w-full h-14 mt-4 text-base">Save meal</button>
      </Sheet>
    </div>
  );
}
