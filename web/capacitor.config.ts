import type { CapacitorConfig } from "@capacitor/cli";

/* The Android app is a thin native shell around the LIVE site.

   It used to bundle a static export of the UI at build time, which meant every UI change needed a
   re-sideload — and in practice the phone ran a two-month-old build and never showed the 2026-09
   redesign. Now `server.url` points the WebView at the deployed site (COACH_PUBLIC_URL, e.g.
   https://gym-coach.<tailnet>.ts.net), so every deploy reaches the phone on next open, while the
   native plugins (Health Connect, notifications, camera, deep links) keep working through the
   Capacitor bridge. `native-shell/` only holds the page shown when the server can't be reached. */

const url = process.env.COACH_PUBLIC_URL;
if (!url) {
  throw new Error(
    "Set COACH_PUBLIC_URL (e.g. https://gym-coach.<your-tailnet>.ts.net) — the app loads the live site from it.",
  );
}

const config: CapacitorConfig = {
  appId: "com.gymcoach.app",
  appName: "Gym Coach",
  webDir: "native-shell",
  server: {
    url,
    // http:// is only for emulator testing against the dev machine (10.0.2.2); real builds are https.
    cleartext: url.startsWith("http://"),
    allowNavigation: [new URL(url).host],
    // Shown instead of a WebView error when Tailscale is off or the desktop is asleep.
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Edge-to-edge UI: status bar overlays the WebView; CSS safe-area padding clears it.
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
      backgroundColor: "#00000000",
    },
  },
};

export default config;
