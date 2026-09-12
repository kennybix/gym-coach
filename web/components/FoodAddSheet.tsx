"use client";
/* The one place food gets added: search Open Food Facts, scan a barcode, photo a meal, re-log a
   recent food, or log a saved meal. Picking a food shows the portion step; "Add to day" closes
   the sheet. Ported from the old inline FoodLog card. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import NumField from "./NumField";
import BarcodeScanner from "./BarcodeScanner";
import FoodPhoto from "./FoodPhoto";
import Sheet from "./ui/Sheet";

export type Food = { code: string | null; name: string; brand: string | null; kcal_100g: number; protein_100g: number; carbs_100g: number; fat_100g: number; fiber_100g: number; serving_g: number | null };
type Macros = { protein_g: number | null; carbs_g?: number | null; fat_g?: number | null; fiber_g?: number | null };
export type Recent = { name: string; brand: string | null; grams: number | null; kcal: number } & Macros;
export type Meal = { id: string; name: string; item_count: number; kcal: number };

export default function FoodAddSheet({
  open, onClose, date, onAdded,
}: { open: boolean; onClose: () => void; date: string; onAdded: () => void }) {
  const [tab, setTab] = useState<"search" | "recent" | "meals">("recent");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);
  const [unit, setUnit] = useState<"g" | "serving">("g");
  const [servings, setServings] = useState(1);
  const [gPerServing, setGPerServing] = useState(100);
  const [scanning, setScanning] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [mKcal, setMKcal] = useState(2000);
  const [mProt, setMProt] = useState(140);

  useEffect(() => {
    if (!open) return;
    apiGet<{ foods: Recent[] }>("/api/foods/recent").then((d) => setRecent(d.foods)).catch(() => setRecent([]));
    apiGet<{ meals: Meal[] }>("/api/meals").then((d) => setMeals(d.meals)).catch(() => setMeals([]));
    setPicked(null); setResults(null); setNotice(null); setManual(false);
    setTab((t) => (recent.length === 0 && t === "recent" ? "search" : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const search = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setSearching(true); setResults(null);
    apiGet<{ foods: Food[] }>(`/api/foods/search?q=${encodeURIComponent(q)}`)
      .then((d) => setResults(d.foods)).catch(() => setResults([])).finally(() => setSearching(false));
  }, [query]);

  const choose = (f: Food) => { setPicked(f); setUnit("g"); setGrams(f.serving_g ?? 100); setServings(1); setGPerServing(f.serving_g ?? 100); };
  const effectiveGrams = picked ? (unit === "serving" ? Math.round(servings * gPerServing) : grams) : 0;

  const add = async () => {
    if (!picked) return;
    const g = effectiveGrams;
    const per = (v: number) => Math.round((v * g) / 100 * 10) / 10;
    await apiPost("/api/foods/log", {
      id: crypto.randomUUID(), logged_on: date, name: picked.name, brand: picked.brand, grams: g,
      kcal: Math.round((picked.kcal_100g * g) / 100),
      protein_g: per(picked.protein_100g), carbs_g: per(picked.carbs_100g), fat_g: per(picked.fat_100g), fiber_g: per(picked.fiber_100g),
    });
    if (navigator.vibrate) navigator.vibrate(12);
    onAdded(); onClose();
  };
  const reLog = async (r: Recent) => {
    await apiPost("/api/foods/log", { id: crypto.randomUUID(), logged_on: date, name: r.name, brand: r.brand, grams: r.grams, kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g });
    if (navigator.vibrate) navigator.vibrate(12);
    onAdded(); onClose();
  };
  const logMeal = async (m: Meal) => { await apiPost("/api/meals/log", { meal_id: m.id, logged_on: date }); onAdded(); onClose(); };
  const deleteMeal = async (m: Meal) => { await apiPost("/api/meals/delete", { meal_id: m.id }); setMeals((p) => p.filter((x) => x.id !== m.id)); };
  const onScanned = async (code: string) => {
    setScanning(false); setNotice(null);
    try {
      const d = await apiGet<{ food: Food | null }>(`/api/foods/barcode/${encodeURIComponent(code)}`);
      if (d.food) choose(d.food); else setNotice(`No food found for barcode ${code}. Try a search.`);
    } catch { setNotice("Barcode lookup failed. Check your connection."); }
  };
  const saveManual = async () => {
    await apiPost("/api/nutrition", { logged_on: date, kcal: mKcal, protein_g: mProt });
    onAdded(); onClose();
  };

  const Seg = ({ id, label }: { id: typeof tab; label: string }) => (
    <button data-on={tab === id} onClick={() => { setTab(id); setResults(null); setPicked(null); }} className="seg h-10 flex-1 text-sm">{label}</button>
  );

  return (
    <>
      <Sheet open={open && !scanning && !photo} onClose={onClose} eyebrow="Add to today" title="Food">
        {picked ? (
          <div>
            <p className="t-h2">{picked.name}</p>
            {picked.brand && <p className="t-sec">{picked.brand}</p>}
            <div className="flex gap-2 mt-4">
              <button data-on={unit === "g"} onClick={() => setUnit("g")} className="seg h-10 flex-1 text-sm">Grams</button>
              <button data-on={unit === "serving"} onClick={() => setUnit("serving")} className="seg h-10 flex-1 text-sm">Servings</button>
            </div>
            <div className="mt-3">
              {unit === "g" ? (
                <NumField value={grams} onChange={setGrams} step={10} min={1} max={5000} unit="g" />
              ) : (
                <div className="space-y-2">
                  <NumField value={servings} onChange={setServings} step={0.5} min={0.5} max={50} decimals={1} unit="×" />
                  <div className="flex items-center gap-2">
                    <span className="t-sec shrink-0 w-24">1 serving =</span>
                    <div className="flex-1 min-w-0"><NumField value={gPerServing} onChange={setGPerServing} step={5} min={1} max={2000} unit="g" compact /></div>
                  </div>
                </div>
              )}
            </div>
            <p className="t-sec mt-3 tnum">
              {Math.round((picked.kcal_100g * effectiveGrams) / 100)} kcal · P {Math.round((picked.protein_100g * effectiveGrams) / 100)} · C {Math.round((picked.carbs_100g * effectiveGrams) / 100)} · F {Math.round((picked.fat_100g * effectiveGrams) / 100)} g
            </p>
            <button onClick={add} className="btn btn-primary w-full h-14 mt-4 text-base">Add to day</button>
            <button onClick={() => setPicked(null)} className="btn btn-quiet w-full h-10 mt-1 text-sm">Back</button>
          </div>
        ) : manual ? (
          <div className="space-y-2.5">
            <NumField label="Energy" unit="kcal" value={mKcal} step={50} min={0} max={20000} onChange={setMKcal} />
            <NumField label="Protein" unit="g" value={mProt} step={5} min={0} max={1000} onChange={setMProt} />
            <button onClick={saveManual} className="btn btn-primary w-full h-14 mt-2 text-base">Save day total</button>
            <button onClick={() => setManual(false)} className="btn btn-quiet w-full h-10 text-sm">Back</button>
          </div>
        ) : (
          <div>
            <div className="flex gap-2">
              <Seg id="search" label="Search" /><Seg id="recent" label="Recent" /><Seg id="meals" label="Meals" />
            </div>
            {tab === "search" && (
              <div className="mt-3">
                <div className="flex gap-2">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search foods" className="field flex-1 min-w-0 h-12 px-4 text-[15px] outline-none" autoCapitalize="off" autoFocus />
                  <button onClick={search} disabled={searching} className="btn btn-primary h-12 px-4 text-sm shrink-0">{searching ? "…" : "Go"}</button>
                </div>
                <div className="flex gap-2 mt-2.5">
                  <button onClick={() => setScanning(true)} className="btn btn-ghost h-11 flex-1 text-sm">Scan barcode</button>
                  <button onClick={() => setPhoto(true)} className="btn btn-ghost h-11 flex-1 text-sm">Photo a meal</button>
                </div>
                {notice && <p className="t-sec mt-2">{notice}</p>}
                {results && (
                  <div className="mt-3 max-h-[40dvh] overflow-auto scroll-soft">
                    {results.map((f, i) => (
                      <button key={i} onClick={() => choose(f)} className="row">
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-[15px]">{f.name}{f.brand && <span className="t-sec ml-2">{f.brand}</span>}</span>
                          <span className="block t-sec tnum">{f.kcal_100g} kcal · {f.protein_100g} g protein per 100 g</span>
                        </span>
                        <span className="text-dim">›</span>
                      </button>
                    ))}
                    {results.length === 0 && <p className="t-sec py-3">No matches. Try another word.</p>}
                  </div>
                )}
              </div>
            )}
            {tab === "recent" && (
              <div className="mt-2 max-h-[46dvh] overflow-auto scroll-soft">
                {recent.length === 0 && <p className="t-sec py-3">Foods you log show up here for one-tap re-logging.</p>}
                {recent.slice(0, 20).map((r, i) => (
                  <button key={i} onClick={() => reLog(r)} className="row">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[15px]">{r.name}</span>
                      <span className="block t-sec tnum">{r.grams ? `${r.grams} g · ` : ""}{r.kcal} kcal · {Math.round(r.protein_g ?? 0)} g protein</span>
                    </span>
                    <span className="text-volt text-lg">+</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "meals" && (
              <div className="mt-2 max-h-[46dvh] overflow-auto scroll-soft">
                {meals.length === 0 && <p className="t-sec py-3">Save a day's foods as a meal and log the whole bundle in one tap.</p>}
                {meals.map((m) => (
                  <div key={m.id} className="row">
                    <button onClick={() => logMeal(m)} className="flex-1 min-w-0 text-left">
                      <span className="block truncate text-[15px]">{m.name}</span>
                      <span className="block t-sec tnum">{m.item_count} item{m.item_count === 1 ? "" : "s"} · {m.kcal} kcal</span>
                    </button>
                    <button onClick={() => deleteMeal(m)} aria-label="delete meal" className="text-dim active:text-alert px-2 text-lg leading-none">×</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setManual(true)} className="btn btn-quiet w-full h-9 mt-3 text-xs">Log a day total instead</button>
          </div>
        )}
      </Sheet>
      {scanning && <BarcodeScanner onCode={onScanned} onClose={() => setScanning(false)} />}
      {photo && <FoodPhoto date={date} onClose={() => setPhoto(false)} onLogged={() => { onAdded(); onClose(); }} />}
    </>
  );
}
