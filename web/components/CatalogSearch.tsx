"use client";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import ExerciseAnimation from "./ExerciseAnimation";

export type CatalogRow = {
  exercise_id: string;
  name: string;
  equipment: string;
  primary_muscles: string[];
  category?: string | null;
  image_urls?: string[];
};

const EQUIPMENT = ["", "none", "dumbbell", "barbell", "kettlebell", "band", "cable", "machine"];

/* Search the seeded exercise catalog and pick results. Reused by the program editor
   and Today's "add exercise" sheet. `pickedIds` get a check + muted styling. */
export default function CatalogSearch({
  onPick,
  pickedIds = [],
}: {
  onPick: (r: CatalogRow) => void;
  pickedIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [equip, setEquip] = useState("");
  const [results, setResults] = useState<CatalogRow[]>([]);

  const search = useCallback(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (equip) p.set("equipment", equip);
    apiGet<{ exercises: CatalogRow[] }>(`/api/catalog/exercises?${p}`)
      .then((d) => setResults(d.exercises))
      .catch(() => setResults([]));
  }, [query, equip]);

  useEffect(() => {
    search();
  }, [equip]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search exercises"
          className="field flex-1 h-11 px-3.5 text-sm outline-none"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button onClick={search} className="btn btn-primary px-5 text-sm">Go</button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {EQUIPMENT.map((e) => (
          <button
            key={e || "all"}
            onClick={() => setEquip(e)}
            className={`chip px-3 py-1.5 text-xs capitalize ${equip === e ? "border-volt text-volt bg-volt/10" : "text-dim"}`}
          >
            {e || "all"}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-line divide-y divide-line max-h-56 overflow-y-auto scroll-soft">
        {results.map((r) => {
          const picked = pickedIds.includes(r.exercise_id);
          return (
            <button
              key={r.exercise_id}
              onClick={() => onPick(r)}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 active:bg-panel2"
            >
              <ExerciseAnimation frames={r.image_urls ?? []} alt={r.name} className="w-11 h-11 rounded-lg shrink-0 border border-line" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-bone/90 truncate">{r.name}</span>
                <span className="block text-dim text-xs capitalize">
                  {r.equipment}{r.category === "cardio" ? " · cardio" : ""}
                </span>
              </span>
              <span className={`text-lg leading-none shrink-0 ${picked ? "text-volt" : "text-dim"}`}>
                {picked ? "✓" : "+"}
              </span>
            </button>
          );
        })}
        {results.length === 0 && <p className="text-dim text-xs p-3.5">No matches — try another search.</p>}
      </div>
    </div>
  );
}
