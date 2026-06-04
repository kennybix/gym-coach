"use client";
/* Hand-rolled SVG line chart — no chart lib, stays on-aesthetic and dependency-free.
 * Emphasizes the trend shape over individual daily readings. */

export type WeightPoint = { date: string; weight_kg: number };

export default function WeightChart({
  series,
  goalKg,
}: {
  series: WeightPoint[];
  goalKg: number | null;
}) {
  if (series.length < 2) {
    return (
      <p className="text-dim text-sm py-8 text-center">
        Log a few more weigh-ins and your trend line shows up here.
      </p>
    );
  }

  const W = 320;
  const H = 150;
  const PAD = 8;

  const ws = series.map((p) => p.weight_kg);
  const lo = Math.min(...ws, goalKg ?? Infinity);
  const hi = Math.max(...ws, goalKg ?? -Infinity);
  const span = hi - lo || 1;

  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (w: number) => PAD + (1 - (w - lo) / span) * (H - PAD * 2);

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.weight_kg)}`).join(" ");
  const area = `${line} L ${x(series.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
  const goalY = goalKg != null ? y(goalKg) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-volt)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-volt)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {goalY != null && (
        <>
          <line
            x1={PAD}
            y1={goalY}
            x2={W - PAD}
            y2={goalY}
            stroke="var(--color-dim)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <text x={W - PAD} y={goalY - 4} textAnchor="end" fontSize="9" fill="var(--color-dim)">
            goal
          </text>
        </>
      )}

      <path d={area} fill="url(#fade)" />
      <path d={line} fill="none" stroke="var(--color-volt)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.weight_kg)} r="2" fill="var(--color-ink)" stroke="var(--color-volt)" strokeWidth="1.5" />
      ))}
    </svg>
  );
}
