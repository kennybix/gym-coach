"use client";
/* Native-only shell behaviour for the Android app. No-op in a normal browser.
   - Status bar overlays the edge-to-edge WebView with light icons; CSS safe-area padding clears it.
   - Deep links: `gymcoach://…` from notifications and home-screen shortcuts open the right screen
     (a weigh-in sheet, the workout, food, coach) — including a cold start.
   - Pairing: `gymcoach://pair?t=<token>` signs the app in.
   - Health Connect: once the user has synced manually (permissions granted), new weigh-ins, blood
     pressure and resting HR are pulled silently whenever the app comes to the foreground, at most
     every 6 hours — so a smart scale or Samsung Health means zero-tap weigh-ins. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { configured } from "@/lib/api";
import { parsePairing, savePairing } from "@/lib/pairing";
import { autoSyncHealth } from "@/lib/health";
import { routeFor } from "@/lib/deeplinks";

export default function NativeShell() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cleanup: (() => void) | undefined;

    const open = (url: string) => {
      if (/^gymcoach:\/\/pair/i.test(url)) {
        const p = parsePairing(url);
        if (p) { savePairing(p); window.location.assign("/"); }
        return;
      }
      const to = routeFor(url);
      if (!to) return;
      // Already on Home? It won't remount for a new query, so ask it to open the sheet directly.
      const sheet = to.match(/^\/\?log=(weight|bp)$/)?.[1];
      if (sheet && window.location.pathname === "/") {
        window.dispatchEvent(new CustomEvent("coach:open-sheet", { detail: sheet }));
        return;
      }
      router.push(to);
    };

    (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Dark }); // "Dark" = light icons
      } catch { /* plugin missing */ }

      try {
        const { App } = await import("@capacitor/app");
        const launch = await App.getLaunchUrl();
        if (launch?.url) open(launch.url);
        const h1 = await App.addListener("appUrlOpen", ({ url }) => open(url));
        const h2 = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive && configured()) void autoSyncHealth();
        });
        cleanup = () => { void h1.remove(); void h2.remove(); };
      } catch { /* @capacitor/app missing on an old build */ }

      if (configured()) void autoSyncHealth();
    })();

    return () => cleanup?.();
  }, [router]);

  return null;
}
