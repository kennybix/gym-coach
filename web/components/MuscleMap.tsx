"use client";
/* A schematic front/back body that highlights the muscles an exercise works — primary in the
   accent colour, secondary dimmer, the rest faint so the figure still reads as a body. The
   muscle names match free-exercise-db (chest, lats, quadriceps, …). */

type Region = { m: string; t: "r" | "e"; x: number; y: number; w: number; h: number };

// viewBox is 0 0 88 176 per figure. Blocky but anatomically placed.
const FRONT: Region[] = [
  { m: "traps", t: "r", x: 30, y: 16, w: 28, h: 7 },
  { m: "shoulders", t: "e", x: 18, y: 33, w: 10, h: 8 }, { m: "shoulders", t: "e", x: 70, y: 33, w: 10, h: 8 },
  { m: "chest", t: "r", x: 26, y: 28, w: 16, h: 15 }, { m: "chest", t: "r", x: 46, y: 28, w: 16, h: 15 },
  { m: "biceps", t: "r", x: 10, y: 42, w: 11, h: 20 }, { m: "biceps", t: "r", x: 67, y: 42, w: 11, h: 20 },
  { m: "forearms", t: "r", x: 8, y: 64, w: 10, h: 22 }, { m: "forearms", t: "r", x: 70, y: 64, w: 10, h: 22 },
  { m: "abdominals", t: "r", x: 33, y: 45, w: 22, h: 28 },
  { m: "abductors", t: "r", x: 19, y: 92, w: 8, h: 20 }, { m: "abductors", t: "r", x: 61, y: 92, w: 8, h: 20 },
  { m: "adductors", t: "r", x: 40, y: 92, w: 8, h: 26 },
  { m: "quadriceps", t: "r", x: 25, y: 92, w: 15, h: 36 }, { m: "quadriceps", t: "r", x: 48, y: 92, w: 15, h: 36 },
  { m: "calves", t: "r", x: 26, y: 132, w: 13, h: 30 }, { m: "calves", t: "r", x: 49, y: 132, w: 13, h: 30 },
];
const BACK: Region[] = [
  { m: "traps", t: "r", x: 28, y: 18, w: 32, h: 16 },
  { m: "shoulders", t: "e", x: 18, y: 33, w: 10, h: 8 }, { m: "shoulders", t: "e", x: 70, y: 33, w: 10, h: 8 },
  { m: "triceps", t: "r", x: 10, y: 42, w: 11, h: 20 }, { m: "triceps", t: "r", x: 67, y: 42, w: 11, h: 20 },
  { m: "forearms", t: "r", x: 8, y: 64, w: 10, h: 22 }, { m: "forearms", t: "r", x: 70, y: 64, w: 10, h: 22 },
  { m: "lats", t: "r", x: 26, y: 38, w: 16, h: 22 }, { m: "lats", t: "r", x: 46, y: 38, w: 16, h: 22 },
  { m: "middle back", t: "r", x: 38, y: 36, w: 12, h: 18 },
  { m: "lower back", t: "r", x: 34, y: 58, w: 20, h: 14 },
  { m: "glutes", t: "e", x: 33, y: 86, w: 12, h: 10 }, { m: "glutes", t: "e", x: 55, y: 86, w: 12, h: 10 },
  { m: "hamstrings", t: "r", x: 25, y: 98, w: 15, h: 32 }, { m: "hamstrings", t: "r", x: 48, y: 98, w: 15, h: 32 },
  { m: "calves", t: "r", x: 26, y: 134, w: 13, h: 28 }, { m: "calves", t: "r", x: 49, y: 134, w: 13, h: 28 },
];

function Figure({ regions, primary, secondary, label }: { regions: Region[]; primary: Set<string>; secondary: Set<string>; label: string }) {
  const fill = (m: string) => (primary.has(m) ? "var(--color-volt)" : secondary.has(m) ? "color-mix(in srgb, var(--color-volt) 38%, transparent)" : "var(--color-panel2)");
  const stroke = (m: string) => (primary.has(m) || secondary.has(m) ? "var(--color-volt)" : "var(--color-line)");
  return (
    <div className="flex-1 min-w-0">
      <svg viewBox="0 0 88 176" className="w-full h-auto">
        <circle cx="44" cy="9" r="8" fill="var(--color-panel2)" stroke="var(--color-line)" strokeWidth="1" />
        {regions.map((r, i) =>
          r.t === "e" ? (
            <ellipse key={i} cx={r.x} cy={r.y} rx={r.w} ry={r.h} fill={fill(r.m)} stroke={stroke(r.m)} strokeWidth="0.8" />
          ) : (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="3" fill={fill(r.m)} stroke={stroke(r.m)} strokeWidth="0.8" />
          )
        )}
      </svg>
      <p className="text-dim text-[10px] text-center uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}

export default function MuscleMap({ primary, secondary }: { primary: string[]; secondary: string[] }) {
  const p = new Set(primary.map((m) => m.toLowerCase()));
  const s = new Set(secondary.map((m) => m.toLowerCase()));
  return (
    <div className="flex gap-4 justify-center">
      <Figure regions={FRONT} primary={p} secondary={s} label="Front" />
      <Figure regions={BACK} primary={p} secondary={s} label="Back" />
    </div>
  );
}
