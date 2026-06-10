"use client";
/* A simple front-view body that maps each measurement onto where it's taken — both a visual
   "model" of your numbers and the answer to "where do I measure?". Bands with a value are in
   the accent colour; bands you haven't logged are faint, as a prompt. */

type Vals = {
  waist_cm?: number | null; chest_cm?: number | null; hips_cm?: number | null;
  arm_cm?: number | null; thigh_cm?: number | null; neck_cm?: number | null;
};

// horizontal girth bands: [y, x-left, x-right]
const BANDS: { key: keyof Vals; label: string; y: number; x1: number; x2: number; side: "l" | "r" }[] = [
  { key: "neck_cm", label: "Neck", y: 36, x1: 72, x2: 88, side: "r" },
  { key: "chest_cm", label: "Chest", y: 58, x1: 56, x2: 104, side: "l" },
  { key: "waist_cm", label: "Waist", y: 90, x1: 62, x2: 98, side: "r" },
  { key: "hips_cm", label: "Hips", y: 114, x1: 58, x2: 102, side: "l" },
];
// limb girths: a short bracket on one limb
const LIMBS: { key: keyof Vals; label: string; cx: number; y: number; side: "l" | "r" }[] = [
  { key: "arm_cm", label: "Arm", cx: 46, y: 62, side: "l" },
  { key: "thigh_cm", label: "Thigh", cx: 68, y: 140, side: "l" },
];

export default function BodyMap({ vals }: { vals: Vals }) {
  const on = (k: keyof Vals) => vals[k] != null && (vals[k] as number) > 0;
  const col = (k: keyof Vals) => (on(k) ? "var(--color-volt)" : "var(--color-line)");
  const txt = (k: keyof Vals, label: string) => (on(k) ? `${label} ${vals[k]}` : label);

  return (
    <svg viewBox="0 0 200 200" className="w-full h-auto" style={{ maxHeight: 230 }}>
      {/* silhouette */}
      <g fill="var(--color-panel2)" stroke="var(--color-line)" strokeWidth="1.2">
        <circle cx="80" cy="18" r="12" />
        <path d="M60,42 H100 L97,72 Q94,84 92,92 L96,116 H64 L68,92 Q66,84 63,72 Z" />
        <rect x="44" y="44" width="9" height="74" rx="4.5" />
        <rect x="107" y="44" width="9" height="74" rx="4.5" />
        <rect x="61" y="116" width="17" height="78" rx="7" />
        <rect x="82" y="116" width="17" height="78" rx="7" />
      </g>

      {/* girth bands */}
      {BANDS.map((b) => (
        <g key={b.key as string}>
          <line x1={b.x1} y1={b.y} x2={b.x2} y2={b.y} stroke={col(b.key)} strokeWidth="2" strokeDasharray="2 2" />
          <text
            x={b.side === "r" ? b.x2 + 6 : b.x1 - 6}
            y={b.y + 3.5}
            textAnchor={b.side === "r" ? "start" : "end"}
            fontSize="9"
            className="tnum"
            fill={on(b.key) ? "var(--color-bone)" : "var(--color-dim)"}
          >
            {txt(b.key, b.label)}
          </text>
        </g>
      ))}

      {/* limb girths */}
      {LIMBS.map((l) => (
        <g key={l.key as string}>
          <line x1={l.cx - 7} y1={l.y} x2={l.cx + 7} y2={l.y} stroke={col(l.key)} strokeWidth="2" strokeDasharray="2 2" />
          <text x={l.cx - 11} y={l.y + 3.5} textAnchor="end" fontSize="9" className="tnum" fill={on(l.key) ? "var(--color-bone)" : "var(--color-dim)"}>
            {txt(l.key, l.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}
