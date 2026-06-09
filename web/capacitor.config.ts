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
};

export default config;
