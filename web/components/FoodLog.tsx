"use client";
/* Food-database logging: search Open Food Facts (or scan a barcode), pick a food, log a
   portion in grams. Recent foods re-log in one tap. The day's nutrition total is recomputed
   server-side from these entries, so the streak, context, trends, and coach stay in sync. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import NumField from "./NumField";
import BarcodeScanner from "./BarcodeScanner";
import FoodPhoto from "./FoodPhoto";

type Food = { code: string | null; name: string; brand: string | null; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; fiber_100g: number; serving_g: number | null };
type Macros = { protein_g: number | null; carbs_g?: number | null; fat_g?: number | null; fiber_g?: number | null };
type Entry = { id: string; name: string; brand: string | null; grams: number | null; kcal: number } & Macros;
type Recent = { name: string; brand: string | null; grams: number | null; kcal: number } & Macros;
type Meal = { id: string; name: string; item_count: number; kcal: number };

export default function FoodLog({ date, onChange }: { date: string; onChange?: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const [unit, setUnit] = useState<"g" | "serving">("g");
  const [servings, setServings] = useState(1);
  const [gPerServing, setGPerServing] = useState(100);
  const [scanning, setScanning] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealName, setMealName] = useState<string | null>(null);

  const loadEntries = useCallback(() => {
    apiGet<{ foods: Entry[] }>(`/api/foods?date=${date}`).then((d) => setEntries(d.foods)).catch(() => setEntries([]));
  }, [date]);
  const loadRecent = useCallback(() => {
    apiGet<{ foods: Recent[] }>("/api/foods/recent").then((d) => setRecent(d.foods)).catch(() => setRecent([]));
  }, []);
  const loadMeals = useCallback(() => {
    apiGet<{ meals: Meal[] }>("/api/meals").then((d) => setMeals(d.meals)).catch(() => setMeals([]));
  }, []);
  useEffect(() => { loadEntries(); loadRecent(); loadMeals(); }, [loadEntries, loadRecent, loadMeals]);

  const refresh = useCallback(() => { loadEntries(); loadRecent(); loadMeals(); onChange?.(); }, [loadEntries, loadRecent, loadMeals, onChange]);

  const logMeal = useCallback(async (m: Meal) => {
    await apiPost("/api/meals/log", { meal_id: m.id, logged_on: date });
    refresh();
  }, [date, refresh]);
  const deleteMeal = useCallback(async (m: Meal) => {
    await apiPost("/api/meals/delete", { meal_id: m.id });
    loadMeals();
  }, [loadMeals]);
  const saveMeal = useCallback(async () => {
    const name = (mealName || "").trim();
    if (!name || entries.length === 0) return;
    await apiPost("/api/meals", {
      name,
      items: entries.map((e) => ({
        name: e.name, brand: e.brand, grams: e.grams, kcal: e.kcal,
        protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g,
      })),
    });
    setMealName(null);
    loadMeals();
  }, [mealName, entries, loadMeals]);

  const search = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults(null);
    apiGet<{ foods: Food[] }>(`/api/foods/search?q=${encodeURIComponent(q)}`)
      .then((d) => setResults(d.foods))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [query]);

  const choose = useCallback((f: Food) => {
    setPicked(f);
    setUnit("g");
    setGrams(100);
    setServings(1);
    setGPerServing(f.serving_g ?? 100);
  }, []);

  const effectiveGrams = picked ? (unit === "serving" ? Math.round(servings * gPerServing) : grams) : 0;

  const add = useCallback(async () => {
    if (!picked) return;
    const g = unit === "serving" ? Math.round(servings * gPerServing) : grams;
    const per = (v: number) => Math.round((v * g) / 100 * 10) / 10;
    await apiPost("/api/foods/log", {
      id: crypto.randomUUID(), logged_on: date, name: picked.name, brand: picked.brand, grams: g,
      kcal: Math.round((picked.kcal_100g * g) / 100),
      protein_g: per(picked.protein_100g), carbs_g: per(picked.carbs_100g),
      fat_g: per(picked.fat_100g), fiber_g: per(picked.fiber_100g),
    });
    setPicked(null); setResults(null); setQuery("");
    refresh();
  }, [picked, unit, servings, gPerServing, grams, date, refresh]);

  const reLog = useCallback(async (r: Recent) => {
    await apiPost("/api/foods/log", {
      id: crypto.randomUUID(), logged_on: date, name: r.name, brand: r.brand, grams: r.grams,
      kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g,
    });
    refresh();
  }, [date, refresh]);

  const remove = useCallback(async (e: Entry) => {
    setEntries((p) => p.filter((x) => x.id !== e.id));
    await apiPost("/api/foods/delete", { id: e.id, logged_on: date });
    refresh();
  }, [date, refresh]);

  const onScanned = useCallback(async (code: string) => {
    setScanning(false);
    setLooking(true);
    setNotice(null);
    try {
      const d = await apiGet<{ food: Food | null }>(`/api/foods/barcode/${encodeURIComponent(code)}`);
      if (d.food) choose(d.food);
      else setNotice(`No food found for barcode ${code}. Try a search instead.`);
    } catch {
      setNotice("Barcode lookup failed — check your connection.");
    } finally {
      setLooking(false);
    }
  }, []);

  const totalK = entries.reduce((s, e) => s + e.kcal, 0);
  const sum = (k: keyof Macros) => Math.round(entries.reduce((s, e) => s + ((e[k] as number) || 0), 0));
  const totalP = sum("protein_g"), totalC = sum("carbs_g"), totalF = sum("fat_g"), totalFib = sum("fiber_g");

  return (
    <div className="card p-5 rise">
      <div className="flex items-baseline justify-between mb-3.5">
        <p className="eyebrow">Food log</p>
        {entries.length > 0 && (
          <span className="tnum text-sm text-dim">
            <span className="text-volt font-semibold">{totalK}</span> kcal
          </span>
        )}
      </div>
      {entries.length > 0 && (totalP + totalC + totalF) > 0 && (
        <div className="flex gap-3 text-[11px] text-dim mb-3 -mt-2 tnum">
          <span>P <span className="text-bone/80">{totalP}</span></span>
          <span>C <span className="text-bone/80">{totalC}</span></span>
          <span>F <span className="text-bone/80">{totalF}</span></span>
          {totalFib > 0 && <span>Fiber <span className="text-bone/80">{totalFib}</span></span>}
          <span className="opacity-60">g</span>
        </div>
      )}

      {/* search + scan — input shrinks (min-w-0), buttons keep size (shrink-0) so the row
          never overflows the card */}
      <div className="flex gap-2 min-w-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search foods…"
          className="field flex-1 min-w-0 h-11 px-3.5 text-sm outline-none"
          autoCapitalize="off"
        />
        <button onClick={search} disabled={searching} className="btn btn-primary px-3.5 text-sm shrink-0">{searching ? "…" : "Search"}</button>
        <button onClick={() => { setScanning(true); setNotice(null); }} aria-label="scan barcode" className="btn btn-ghost px-2.5 shrink-0" title="Scan barcode">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" /></svg>
        </button>
        <button onClick={() => setPhoto(true)} aria-label="photo a meal" className="btn btn-ghost px-2.5 shrink-0" title="Photo a meal">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
        </button>
      </div>

      {looking && <p className="text-dim text-xs mt-2">Looking up barcode…</p>}
      {notice && <p className="text-dim text-xs mt-2">{notice}</p>}

      {/* saved meals — one-tap log the whole bundle */}
      {meals.length > 0 && !results && !picked && (
        <div className="mt-3">
          <p className="text-dim text-xs mb-2">Meals</p>
          <div className="flex flex-wrap gap-1.5">
            {meals.map((m) => (
              <span key={m.id} className="chip inline-flex items-center pl-3 pr-1 py-1.5 text-xs text-bone/90">
                <button onClick={() => logMeal(m)} className="active:text-volt">
                  {m.name.length > 20 ? m.name.slice(0, 20) + "…" : m.name}
                  <span className="text-dim ml-1.5 tnum">{m.kcal}</span>
                </button>
                <button onClick={() => deleteMeal(m)} aria-label="delete meal" className="text-dim hover:text-alert px-1.5 text-sm leading-none">×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* recent — one-tap re-log */}
      {recent.length > 0 && !results && !picked && (
        <div className="mt-3">
          <p className="text-dim text-xs mb-2">Recent</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.slice(0, 8).map((r, i) => (
              <button key={i} onClick={() => reLog(r)} className="chip px-3 py-1.5 text-xs text-bone/90 active:border-volt active:text-volt">
                {r.name.length > 22 ? r.name.slice(0, 22) + "…" : r.name}
                <span className="text-dim ml-1.5 tnum">{r.kcal}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* search results */}
      {results && (
        <div className="rounded-xl border border-line divide-y divide-line max-h-56 overflow-auto scroll-soft mt-3">
          {results.map((f, i) => (
            <button key={i} onClick={() => choose(f)} className="w-full text-left px-3.5 py-2.5 active:bg-panel2">
              <span className="text-sm text-bone/90">{f.name}</span>
              {f.brand && <span className="text-dim text-xs ml-2">{f.brand}</span>}
              <span className="block text-dim text-xs mt-0.5 tnum">{f.kcal_100g} kcal · {f.protein_100g} g protein / 100g</span>
            </button>
          ))}
          {results.length === 0 && <p className="text-dim text-xs p-3.5">No matches — try another search.</p>}
        </div>
      )}

      {/* add-with-grams */}
      {picked && (
        <div className="mt-3 field p-3 space-y-3">
          <p className="text-sm font-medium">{picked.name}{picked.brand ? ` · ${picked.brand}` : ""}</p>
          <div className="flex gap-2">
            <button data-on={unit === "g"} onClick={() => setUnit("g")} className="seg h-9 flex-1 text-xs">Grams</button>
            <button data-on={unit === "serving"} onClick={() => setUnit("serving")} className="seg h-9 flex-1 text-xs">Servings</button>
          </div>
          {unit === "g" ? (
            <NumField label="Grams" value={grams} onChange={setGrams} step={10} min={1} max={5000} unit="g" />
          ) : (
            <div className="space-y-2">
              <NumField label="Servings" value={servings} onChange={setServings} step={0.5} min={0.5} max={50} decimals={1} unit="×" />
              <div className="flex items-center gap-2">
                <span className="text-dim text-xs shrink-0 w-20 pl-1">1 serving =</span>
                <div className="flex-1 min-w-0"><NumField value={gPerServing} onChange={setGPerServing} step={5} min={1} max={2000} unit="g" compact /></div>
              </div>
            </div>
          )}
          <p className="text-dim text-xs tnum">
            {unit === "serving" ? `${effectiveGrams} g · ` : ""}= {Math.round((picked.kcal_100g * effectiveGrams) / 100)} kcal
            {" · "}P {Math.round((picked.protein_100g * effectiveGrams) / 100 * 10) / 10}
            {" · "}C {Math.round((picked.carbs_100g * effectiveGrams) / 100 * 10) / 10}
            {" · "}F {Math.round((picked.fat_100g * effectiveGrams) / 100 * 10) / 10} g
          </p>
          <div className="flex gap-2">
            <button onClick={add} className="btn btn-primary flex-1 h-10 text-sm">Add to day</button>
            <button onClick={() => setPicked(null)} className="btn btn-ghost h-10 px-4 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* today's entries */}
      {entries.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} className="py-2.5 flex items-center gap-2">
              <span className="flex-1 min-w-0">
                <span className="text-sm text-bone/90">{e.name}</span>
                {e.brand && <span className="text-dim text-xs ml-2">{e.brand}</span>}
                <span className="block text-dim text-xs mt-0.5 tnum">
                  {e.grams ? `${e.grams} g · ` : ""}{e.kcal} kcal · {e.protein_g ?? 0} g protein
                </span>
              </span>
              <button onClick={() => remove(e)} aria-label="remove food" className="text-dim hover:text-alert px-2 text-base leading-none shrink-0">×</button>
            </li>
          ))}
        </ul>
      )}

      {/* save the day's foods as a reusable meal */}
      {entries.length > 0 && !picked && !results && (
        mealName === null ? (
          <button onClick={() => setMealName("")} className="text-xs text-dim active:text-volt mt-3">+ Save these as a meal</button>
        ) : (
          <div className="flex gap-2 mt-3">
            <input
              value={mealName}
              onChange={(e) => setMealName(e.target.value)}
              placeholder="Meal name (e.g. My breakfast)"
              className="field flex-1 min-w-0 h-10 px-3 text-sm outline-none"
              autoFocus
            />
            <button onClick={saveMeal} disabled={!mealName.trim()} className="btn btn-primary h-10 px-4 text-sm">Save</button>
            <button onClick={() => setMealName(null)} className="btn btn-ghost h-10 px-3 text-sm">×</button>
          </div>
        )
      )}
      {entries.length === 0 && !results && recent.length === 0 && (
        <p className="text-dim text-xs mt-3">Search or scan a food to add it — the day total updates automatically and feeds your trends + coach.</p>
      )}

      {scanning && <BarcodeScanner onCode={onScanned} onClose={() => setScanning(false)} />}
      {photo && <FoodPhoto date={date} onClose={() => setPhoto(false)} onLogged={refresh} />}
    </div>
  );
}
