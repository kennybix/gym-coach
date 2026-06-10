"use client";
import { useEffect, useRef, useState } from "react";

/* A numeric field you can BOTH type into and step with −/+ buttons.
   Typing is free-form while focused; the value is parsed live and clamped on blur. */
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function fmt(n: number, decimals: number) {
  return decimals > 0 ? n.toFixed(decimals) : String(n);
}

export default function NumField({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  unit,
  decimals = 0,
  label,
  compact = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  decimals?: number;
  label?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState(fmt(value, decimals));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmt(value, decimals));
  }, [value, decimals]);

  const bump = (d: number) => {
    const next = clamp(+(value + d).toFixed(4), min, max);
    onChange(decimals > 0 ? +next.toFixed(decimals) : Math.round(next));
  };

  const btn = compact ? "w-8 h-10 text-xl" : "w-11 h-14 text-2xl";
  const num = compact ? "text-lg" : "text-2xl";
  return (
    <div className="field flex items-center min-w-0 overflow-hidden">
      {label && <span className="pl-4 text-dim text-sm w-20 shrink-0 truncate">{label}</span>}
      <button
        type="button"
        aria-label="decrease"
        className={`${btn} text-dim active:text-volt rounded-l-[0.9rem] shrink-0`}
        onClick={() => bump(-step)}
      >
        −
      </button>
      <div className="flex-1 min-w-0 flex items-baseline justify-center gap-1 px-1">
        <input
          value={text}
          inputMode="decimal"
          enterKeyHint="done"
          aria-label={label || "value"}
          onFocus={(e) => {
            focused.current = true;
            e.target.select();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const n = parseFloat(raw);
            if (Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
          onBlur={() => {
            focused.current = false;
            setText(fmt(value, decimals));
          }}
          className={`flex-1 min-w-[2ch] bg-transparent text-center font-display tnum ${num} font-bold outline-none`}
        />
        {unit && <span className="text-dim text-[11px] min-w-0 shrink truncate">{unit}</span>}
      </div>
      <button
        type="button"
        aria-label="increase"
        className={`${btn} text-dim active:text-volt rounded-r-[0.9rem] shrink-0`}
        onClick={() => bump(step)}
      >
        +
      </button>
    </div>
  );
}
