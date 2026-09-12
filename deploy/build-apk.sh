#!/usr/bin/env bash
# Build the sideloadable Android APK: a Capacitor shell that bundles the static web export
# (web/out) and talks to the backend over Tailscale, plus the Health Connect bridge.
#
# Prereqs on this machine (one-time):
#   - Android SDK at ~/Android (cmdline-tools + platforms;android-36 + build-tools;36.0.0)
#   - a FULL JDK 21 at ~/jdk (Temurin) — the system Java is a JRE (no javac)
# Plugin version fixes (Kotlin 1.9.25 + jvmTarget 17) are captured in web/patches via
# patch-package, re-applied automatically on npm install.
set -euo pipefail
cd "$(dirname "$0")/../web"

# The APK talks to the backend over the network, so the build needs the URL the app is served
# from. Keep it in .env (gitignored) rather than committed, so a clone doesn't ship your host.
if [ -f ../.env ]; then set -a; . ../.env; set +a; fi
: "${COACH_PUBLIC_URL:?set COACH_PUBLIC_URL in .env, e.g. https://gym-coach.<your-tailnet>.ts.net}"

export ANDROID_HOME="$HOME/Android" ANDROID_SDK_ROOT="$HOME/Android"
JDK="$(find "$HOME/jdk" -maxdepth 1 -name 'jdk-21*' -type d | head -1)"
[ -n "$JDK" ] || { echo "Need a full JDK 21 in ~/jdk (download Temurin 21)"; exit 1; }
export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"

rm -f public/gym-coach.apk            # don't bundle a previous APK into the static export (size bloat)
npm run build:native                 # static export -> web/out (absolute tailnet API URL baked)
npx cap sync android                 # copy web/out + plugins into the android project
( cd android && ./gradlew assembleDebug --no-daemon )

cp android/app/build/outputs/apk/debug/app-debug.apk public/gym-coach.apk
echo
echo "APK built: web/android/app/build/outputs/apk/debug/app-debug.apk"
echo "To serve it for sideloading:  (cd web && npm run build) && systemctl --user restart coach-frontend"
echo "Then on the phone (Tailscale on): download $COACH_PUBLIC_URL/gym-coach.apk"
