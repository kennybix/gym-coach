/* Looks (themes). Each look is a block of CSS variables in globals.css keyed by
   <html data-theme="…">. The choice lives in localStorage and is stamped before first paint by
   NO_FLASH_SCRIPT (inlined in layout.tsx), so a page never renders in the wrong look. */

export type ThemeId = "volt" | "paper" | "ember" | "glacier" | "mono";
export type ThemeChoice = ThemeId | "auto";

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  blurb: string;
  dark: boolean;
  /* swatches for the picker: ground, panel, accent, text */
  swatch: [string, string, string, string];
};

export const THEMES: ThemeMeta[] = [
  { id: "volt", name: "Volt", blurb: "Dark with a lime charge. The original.", dark: true, swatch: ["#0a0b0f", "#15171e", "#bef264", "#f4f5f7"] },
  { id: "paper", name: "Paper", blurb: "Light, warm, cobalt. Reads like a notebook.", dark: false, swatch: ["#f3f1ea", "#fbfaf6", "#2447e8", "#16181d"] },
  { id: "ember", name: "Ember", blurb: "Dark and warm, with a coral glow.", dark: true, swatch: ["#120e0c", "#1d1614", "#ff7a45", "#f7f0e8"] },
  { id: "glacier", name: "Glacier", blurb: "Deep navy, ice-blue accent. Calm.", dark: true, swatch: ["#0a0f1f", "#111a2e", "#7dd3fc", "#eef2ff"] },
  { id: "mono", name: "Mono", blurb: "Black, white, nothing else.", dark: true, swatch: ["#0b0b0b", "#161616", "#ffffff", "#f6f6f6"] },
];

export const THEME_KEY = "coach_theme";

export function resolveTheme(choice: ThemeChoice): ThemeId {
  if (choice !== "auto") return choice;
  if (typeof window === "undefined") return "volt";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "paper" : "volt";
}

export function getThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") return "volt";
  try {
    const v = localStorage.getItem(THEME_KEY) as ThemeChoice | null;
    if (v === "auto" || THEMES.some((t) => t.id === v)) return v!;
  } catch {}
  return "volt";
}

export function applyTheme(choice: ThemeChoice) {
  const id = resolveTheme(choice);
  const meta = THEMES.find((t) => t.id === id)!;
  const html = document.documentElement;
  html.setAttribute("data-theme", id);
  html.style.colorScheme = meta.dark ? "dark" : "light";
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", meta.swatch[0]);
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {}
  window.dispatchEvent(new CustomEvent("coach:theme", { detail: { choice, id } }));
}

/* Runs before hydration. Keep in sync with resolveTheme/THEMES above. */
export const NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"volt";var ids={volt:1,paper:1,ember:1,glacier:1,mono:1};if(t==="auto"){t=matchMedia("(prefers-color-scheme: light)").matches?"paper":"volt"}if(!ids[t]){t="volt"}var h=document.documentElement;h.setAttribute("data-theme",t);h.style.colorScheme=(t==="paper")?"light":"dark";var g={volt:"#0a0b0f",paper:"#f3f1ea",ember:"#120e0c",glacier:"#0a0f1f",mono:"#0b0b0b"};var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",g[t])}}catch(e){}})();`;
