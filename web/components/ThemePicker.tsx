"use client";
/* Pick a look. Applies instantly (no reload) and persists. "Auto" follows the phone: Paper by
   day (light), Volt at night (dark). */
import { useEffect, useState } from "react";
import { applyTheme, getThemeChoice, THEMES, type ThemeChoice } from "@/lib/theme";

export default function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>("volt");
  useEffect(() => setChoice(getThemeChoice()), []);

  const pick = (c: ThemeChoice) => {
    setChoice(c);
    applyTheme(c);
    if (navigator.vibrate) navigator.vibrate(8);
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5">
        {THEMES.map((t) => {
          const on = choice === t.id;
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              aria-pressed={on}
              className={`rounded-2xl p-2.5 text-left border transition-transform active:scale-95 ${on ? "border-volt" : "border-line"}`}
              style={{ background: t.swatch[0] }}
            >
              <div className="rounded-xl p-2 space-y-1.5" style={{ background: t.swatch[1] }}>
                <div className="h-1.5 w-8 rounded-full" style={{ background: t.swatch[3], opacity: 0.85 }} />
                <div className="h-1.5 w-12 rounded-full" style={{ background: t.swatch[3], opacity: 0.35 }} />
                <div className="h-4 w-full rounded-md" style={{ background: t.swatch[2] }} />
              </div>
              <p className="font-display font-semibold text-xs mt-2" style={{ color: t.swatch[3] }}>{t.name}</p>
            </button>
          );
        })}
        <button
          onClick={() => pick("auto")}
          aria-pressed={choice === "auto"}
          className={`rounded-2xl p-2.5 text-left border bg-panel transition-transform active:scale-95 ${choice === "auto" ? "border-volt" : "border-line"}`}
        >
          <div className="rounded-xl p-2 h-[46px] flex items-center justify-center bg-panel2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="text-dim">
              <circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <p className="font-display font-semibold text-xs mt-2">Auto</p>
        </button>
      </div>
      <p className="t-sec mt-3 leading-snug">
        {choice === "auto"
          ? "Follows your phone: Paper in light mode, Volt in dark."
          : THEMES.find((t) => t.id === choice)?.blurb}
      </p>
    </div>
  );
}
