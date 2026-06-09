# Gym Coach — native Android app (Health Connect sync)

A PWA can't read **Health Connect** (it's on-device only), so to auto-import weight / blood
pressure / resting heart rate we ship a thin **native Android shell** via Capacitor. It bundles
the static web export and talks to the backend over Tailscale — same app, same data.

## Architecture
- **`NATIVE_BUILD=1 next build`** → static export (`web/out`) with the tailnet API URL baked in
  (`NEXT_PUBLIC_API_URL`). No Next server in the app, so it calls the backend directly; backend
  CORS allows `https://localhost` (the Capacitor origin).
- **Capacitor** (`com.gymcoach.app`) wraps `web/out` into an Android APK (`web/android/`).
- **Health Connect bridge** (`web/lib/health.ts`, native-only) reads Weight / BloodPressure /
  RestingHeartRate and pushes them through the normal idempotent endpoints (weight = per-day
  upsert; vitals keyed by the Health Connect record id). Triggered from **Setup → Sync from
  Health Connect** (only shown on the native app).

## Build
```bash
bash deploy/build-apk.sh
```
Toolchain (one-time): Android SDK at `~/Android` (cmdline-tools + `platforms;android-36` +
`build-tools;36.0.0`), and a **full JDK 21** at `~/jdk` (the system Java is a JRE — no `javac`).

Version pins that matter (chased during bring-up): **AGP 8.9.1**, **compileSdk/targetSdk 36**,
**minSdk 26** (Health Connect), build on **JDK 21**, but the kiwi Health Connect plugin's Kotlin
bumped to **1.9.25** with **jvmTarget 17** (captured in `web/patches/` via patch-package).

## Sideload onto the phone
1. `(cd web && npm run build) && systemctl --user restart coach-frontend` — serves the APK
   (Next serves `public/` only for files present at build time).
2. On the S26+ (Tailscale on): open **https://gym-coach.taile8b1de.ts.net/gym-coach.apk**, let
   Chrome download it, tap to install (allow "install unknown apps" once).
3. Open the app → **Setup → Sync from Health Connect** → grant the weight/BP/HR read permissions.

> Debug-signed APK (fine for personal sideloading; not Play-Store distributable as-is). The
> first Health Connect sync needs you to grant permissions in the Health Connect consent screen.
