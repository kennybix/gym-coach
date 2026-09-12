"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; match: (p: string) => boolean; icon: React.ReactNode };

const I = (path: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const TABS: Tab[] = [
  { href: "/", label: "Home", match: (p) => p === "/" || p.startsWith("/workout"),
    icon: I(<><path d="M3.5 11.5 12 4l8.5 7.5" /><path d="M5.5 10v9.5h13V10" /></>) },
  { href: "/train", label: "Train", match: (p) => ["/train", "/programs", "/program", "/history"].some((r) => p.startsWith(r)),
    icon: I(<><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" /></>) },
  { href: "/nutrition", label: "Food", match: (p) => p.startsWith("/nutrition"),
    icon: I(<><path d="M12 21c4-3 6.5-6 6.5-10A6.5 6.5 0 0 0 12 4.5 6.5 6.5 0 0 0 5.5 11c0 4 2.5 7 6.5 10Z" /><path d="M12 12.5c1.6 0 2.5-1 2.5-2.5" /></>) },
  { href: "/trends", label: "Progress", match: (p) => p.startsWith("/trends"),
    icon: I(<><path d="M4 16l4.5-5 3.5 3 4-6" /><path d="M4 20h16" /></>) },
  { href: "/coach", label: "Coach", match: (p) => p.startsWith("/coach"),
    icon: I(<><path d="M5 5h14v10H9l-4 4Z" /><path d="M9 9h6M9 11.5h4" /></>) },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-ink/85 backdrop-blur-xl">
      <div
        className="max-w-md mx-auto grid grid-cols-5 px-2 pt-1.5"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        {TABS.map((t) => {
          const active = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-1 py-2 rounded-xl transition-colors ${
                active ? "text-volt" : "text-dim active:text-bone"
              }`}
            >
              {t.icon}
              <span className={`text-[10px] font-mono tracking-wide ${active ? "font-semibold" : "font-medium"}`}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
