"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; icon: (active: boolean) => React.ReactNode };

const I = (path: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const TABS: Tab[] = [
  { href: "/", label: "Today", icon: () => I(<><path d="M3.5 11.5 12 4l8.5 7.5" /><path d="M5.5 10v9.5h13V10" /></>) },
  { href: "/trends", label: "Trends", icon: () => I(<><path d="M4 16l4.5-5 3.5 3 4-6" /><path d="M4 20h16" /></>) },
  { href: "/nutrition", label: "Fuel", icon: () => I(<><path d="M12 21c4-3 6.5-6 6.5-10A6.5 6.5 0 0 0 12 4.5 6.5 6.5 0 0 0 5.5 11c0 4 2.5 7 6.5 10Z" /><path d="M12 12.5c1.6 0 2.5-1 2.5-2.5" /></>) },
  { href: "/coach", label: "Coach", icon: () => I(<><path d="M5 5h14v10H9l-4 4Z" /><path d="M9 9h6M9 11.5h4" /></>) },
  { href: "/settings", label: "Setup", icon: () => I(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>) },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-ink/80 backdrop-blur-xl">
      <div
        className="max-w-md mx-auto grid grid-cols-5 px-2 pt-1.5"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-1 py-2 rounded-xl transition-colors ${
                active ? "text-volt" : "text-dim active:text-bone"
              }`}
            >
              {t.icon(active)}
              <span className={`text-[10px] tracking-wide ${active ? "font-semibold" : "font-medium"}`}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
