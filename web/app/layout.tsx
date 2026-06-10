import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "@/components/SwRegister";
import DevAutoConfig from "@/components/DevAutoConfig";
import NavBar from "@/components/NavBar";
import NativeShell from "@/components/NativeShell";

export const metadata: Metadata = {
  title: "Gym Coach",
  description: "Personal training log + AI coach",
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GymCoach" },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Required so env(safe-area-inset-*) is populated under the status bar / gesture nav — the
  // native WebView (Capacitor) renders edge-to-edge and won't pad for the bars otherwise.
  viewportFit: "cover",
  // When the soft keyboard opens, resize the layout (don't pan the window) so fixed elements —
  // the bottom nav, the coach input — stay put instead of being pushed off-screen.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh flex flex-col">
        <SwRegister />
        <DevAutoConfig />
        <NativeShell />
        {/* Top/bottom padding fold in the safe-area insets (0 in a normal browser, the status-bar
            / gesture-bar heights in the native WebView), so the header clears the clock and content
            clears the nav bar. */}
        <main
          className="flex-1 w-full max-w-md mx-auto px-5"
          style={{
            paddingTop: "calc(1.75rem + env(safe-area-inset-top))",
            paddingBottom: "calc(7rem + env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </main>
        <NavBar />
      </body>
    </html>
  );
}
