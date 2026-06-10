"use client";
/* Front-view body that maps each measurement onto where it's taken — a visual "model" of your
   numbers and the answer to "where do I measure?". Girths label down the right, limbs down the
   left, so nothing overlaps. Logged bands are accent-coloured; unlogged ones are faint prompts. */

type Vals = {
  waist_cm?: number | null; belly_cm?: number | null; chest_cm?: number | null; hips_cm?: number | null;
  arm_cm?: number | null; thigh_cm?: number | null; neck_cm?: number | null;
};

// girth bands across the torso (label to the right). y top->bottom.
const BANDS: { key: keyof Vals; label: string; y: number; x1: number; x2: number }[] = [
  { key: "neck_cm", label: "Neck", y: 46, x1: 110, x2: 130 },
  { key: "chest_cm", label: "Chest", y: 74, x1: 92, x2: 148 },
  { key: "waist_cm", label: "Waist", y: 108, x1: 100, x2: 140 },
  { key: "belly_cm", label: "Belly", y: 123, x1: 98, x2: 142 },
  { key: "hips_cm", label: "Hips", y: 141, x1: 92, x2: 148 },
];
// limb girths (label to the left): a short bracket on a limb.
const LIMBS: { key: keyof Vals; label: string; x: number; y: number }[] = [
  { key: "arm_cm", label: "Arm", x: 80, y: 96 },
  { key: "thigh_cm", label: "Thigh", x: 104, y: 180 },
];

const R_LABEL = 190; // right label column x
const L_LABEL = 50; // left label column x

// torso+legs silhouettes — male reads broader-shouldered, female narrower-shoulder/wider-hip
const MALE_BODY =
  "M112,41 C104,43 96,47 90,55 C86,65 85,75 87,87 C89,99 91,104 100,112 C97,120 95,130 96,142 " +
  "C97,152 98,162 100,178 C101,198 102,212 104,230 L114,230 C115,208 116,188 117,150 L120,143 " +
  "L123,150 C124,188 125,208 126,230 L136,230 C138,212 139,198 140,178 C142,162 143,152 144,142 " +
  "C145,130 143,120 140,112 C149,104 151,99 153,87 C155,75 154,65 150,55 C144,47 136,43 128,41 Z";
const FEMALE_BODY =
  "M113,41 C106,43 100,48 96,57 C93,67 93,77 95,88 C96,98 97,103 103,110 C100,118 98,128 98,140 " +
  "C98,150 95,160 92,177 C95,197 99,213 102,230 L113,230 C114,208 115,188 117,150 L120,144 " +
  "L123,150 C125,188 126,208 127,230 L138,230 C141,213 145,197 148,177 C145,160 142,150 142,140 " +
  "C142,128 140,118 137,110 C143,103 144,98 145,88 C147,77 147,67 144,57 C140,48 134,43 127,41 Z";

export default function BodyMap({ vals, sex }: { vals: Vals; sex?: string | null }) {
  const body = (sex || "").toLowerCase().startsWith("f") ? FEMALE_BODY : MALE_BODY;
  const on = (k: keyof Vals) => vals[k] != null && (vals[k] as number) > 0;
  const stroke = (k: keyof Vals) => (on(k) ? "var(--color-volt)" : "var(--color-line)");
  const fill = (k: keyof Vals) => (on(k) ? "var(--color-bone)" : "var(--color-dim)");

  return (
    <svg viewBox="0 0 240 244" className="w-full h-auto" style={{ maxHeight: 250 }}>
      {/* silhouette: head + torso/legs + two arms */}
      <g fill="var(--color-panel2)" stroke="var(--color-line)" strokeWidth="1.3" strokeLinejoin="round">
        <circle cx="120" cy="27" r="15" />
        <path d={body} />
        <path d="M90,57 C82,60 76,70 76,84 C77,101 79,116 82,130 C83,135 89,135 89,128
                 C88,113 88,99 89,85 C89,73 91,64 93,57 Z" />
        <path d="M150,57 C158,60 164,70 164,84 C163,101 161,116 158,130 C157,135 151,135 151,128
                 C152,113 152,99 151,85 C151,73 149,64 147,57 Z" />
      </g>

      {/* girth bands + right-column labels */}
      {BANDS.map((b) => (
        <g key={b.key as string}>
          <line x1={b.x1} y1={b.y} x2={b.x2} y2={b.y} stroke={stroke(b.key)} strokeWidth="2.2" strokeDasharray="2.5 2.5" />
          <line x1={b.x2} y1={b.y} x2={R_LABEL - 3} y2={b.y} stroke="var(--color-line)" strokeWidth="0.7" />
          <text x={R_LABEL} y={b.y + 3.4} textAnchor="start" fontSize="10" className="tnum" fill={fill(b.key)}>
            {on(b.key) ? `${b.label} ${vals[b.key]}` : b.label}
          </text>
        </g>
      ))}

      {/* limb girths + left-column labels */}
      {LIMBS.map((l) => (
        <g key={l.key as string}>
          <line x1={l.x - 7} y1={l.y} x2={l.x + 7} y2={l.y} stroke={stroke(l.key)} strokeWidth="2.2" strokeDasharray="2.5 2.5" />
          <line x1={L_LABEL + 3} y1={l.y} x2={l.x - 7} y2={l.y} stroke="var(--color-line)" strokeWidth="0.7" />
          <text x={L_LABEL} y={l.y + 3.4} textAnchor="end" fontSize="10" className="tnum" fill={fill(l.key)}>
            {on(l.key) ? `${l.label} ${vals[l.key]}` : l.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
