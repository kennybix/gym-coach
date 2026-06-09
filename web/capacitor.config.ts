import type { CapacitorConfig } from "@capacitor/cli";

// The Android shell bundles the static export (web/out) and calls the backend directly over
// Tailscale. App id / name are for the sideloaded personal build.
const config: CapacitorConfig = {
  appId: "com.gymcoach.app",
  appName: "Gym Coach",
  webDir: "out",
  android: {
    // allow the app's https://localhost origin to reach the tailnet backend
    allowMixedContent: false,
  },
  plugins: {
    // Edge-to-edge dark UI: status bar overlays the WebView with light icons; CSS safe-area
    // padding (viewport-fit=cover) clears it. Set here too so it applies before JS runs.
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
      backgroundColor: "#00000000",
    },
  },
};

export default config;
