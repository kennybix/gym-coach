# Gym Coach — the Android app

A PWA can't read **Health Connect**, register home-screen shortcuts, or open from a `gymcoach://`
link, so there's a thin **native Android shell** built with Capacitor (`com.gymcoach.app`).

## Architecture: a native shell around the live site

- The WebView loads the **deployed site** (`server.url` = `COACH_PUBLIC_URL`, e.g.
  `https://gym-coach.<your-tailnet>.ts.net`). Every UI deploy reaches the phone on the next app
  open — **no reinstall for UI changes.**
  *(It used to bundle a static export of the UI at build time. In practice the phone ran a
  two-month-old build and never showed the 2026-09 redesign. Don't go back to bundling.)*
- Native plugins keep working through the Capacitor bridge: Health Connect
  (`@kiwi-health/capacitor-health-connect`), camera, local notifications, status bar, and
  `@capacitor/app` for deep links.
- **Offline page:** if the server can't be reached (Tailscale off, desktop asleep) the shell shows
  `web/native-shell/offline.html` with a *Try again* button instead of a WebView error.
- **Deep links:** the manifest registers the `gymcoach://` scheme; `web/components/NativeShell.tsx`
  routes them (`web/lib/deeplinks.ts`), including on a cold start:

  | Link | Opens |
  |---|---|
  | `gymcoach://log/weight` · `gymcoach://log/bp` | Home with the weigh-in / blood-pressure sheet open |
  | `gymcoach://workout` · `gymcoach://food` · `gymcoach://coach` | that screen |
  | `gymcoach://pair?t=<token>` | signs the app in |

- **Home-screen shortcuts** (long-press the icon): Weigh in · Start workout · Log food · Log blood
  pressure (`res/xml/shortcuts.xml`), each a `gymcoach://` link.
- **Health Connect:** the first sync is manual (**Setup → Sync from Health Connect**, which asks for
  permissions). After that, new weigh-ins, blood pressure and resting HR sync **silently whenever
  the app comes to the foreground**, at most every 6 hours — a smart scale or Samsung Health means
  zero-tap weigh-ins.

## Build and publish

```bash
bash deploy/build-apk.sh
```

It runs `cap sync` + Gradle, copies the APK to `web/public/gym-coach.apk`, rebuilds the site so
Next serves the new file, and restarts `coach-frontend`. It no longer touches the site's own build.

**Rebuild the APK only when native parts change** (plugins, manifest, shortcuts, offline page).

Toolchain (one-time): Android SDK at `~/Android` (cmdline-tools + `platforms;android-36` +
`build-tools;36.0.0`) and a **full JDK 21** at `~/jdk`. Version pins that matter: **AGP 8.9.1**,
**compileSdk/targetSdk 36**, **minSdk 26** (Health Connect); the kiwi plugin's Kotlin is bumped to
**1.9.25** with **jvmTarget 17** via `web/patches/` (patch-package).

## Install on the phone

Run `python pair.py` on the computer and scan code **1** (download), then code **3** (sign in)
with the app's **Scan pairing code** button. Installing over an older build works (same debug
signing key since June 2026); you'll sign in once more because the app now loads a different
origin.

## Testing on the emulator (before handing over an APK)

```bash
~/Android/emulator/emulator -avd readapage -no-window -no-audio &
adb reverse tcp:3010 tcp:3010                       # localhost is a secure context in the WebView
APK_SERVER_URL=http://localhost:3010 bash deploy/build-apk.sh    # test build, not published
adb install -r web/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -a android.intent.action.VIEW -d "gymcoach://log/weight" com.gymcoach.app
adb exec-out screencap -p > shot.png
```

Point `APK_SERVER_URL` at a dead port (e.g. `http://localhost:3999`) to see the offline page.

> Debug-signed APK — fine for personal sideloading, not Play-Store distributable as-is.
