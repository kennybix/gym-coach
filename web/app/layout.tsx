import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import SwRegister from "@/components/SwRegister";

export const metadata: Metadata = {
  title: "Gym Coach",
  description: "Personal training log + AI coach",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GymCoach" },
};

export const viewport: Viewport = {
  themeColor: "#0c0d0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

const TABS = [
  { href: "/", label: "TODAY" },
  { href: "/trends", label: "TRENDS" },
  { href: "/coach", label: "COACH" },
  { href: "/settings", label: "SET-UP" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts load at runtime; build stays offline-safe */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh flex flex-col">
        <SwRegister />
        <main className="flex-1 w-full max-w-md mx-auto px-4 pb-28 pt-5">{children}</main>
        <nav className="fixed bottom-0 inset-x-0 border-t border-line bg-panel/95 backdrop-blur">
          <div className="max-w-md mx-auto grid grid-cols-4">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="font-display text-[11px] tracking-[0.18em] text-dim text-center py-4 active:text-volt"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </nav>
      </body>
    </html>
  );
}
