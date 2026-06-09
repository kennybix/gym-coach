"use client";
/* Native-only shell tweaks. On the Capacitor app the WebView is edge-to-edge, so make the
   status bar overlay with light icons (the app is dark) — the CSS safe-area padding in the
   layout then clears the status bar / gesture nav. No-op in a normal browser. */
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export default function NativeShell() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Dark }); // "Dark" = light icons, for our dark UI
      } catch {
        /* plugin missing / not native — ignore */
      }
    })();
  }, []);
  return null;
}
