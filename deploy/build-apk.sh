#!/usr/bin/env bash
# Build the sideloadable Android APK: a thin Capacitor shell that loads the LIVE site
# (COACH_PUBLIC_URL) plus the native bridges — Health Connect, notifications, camera, deep links.
#
# Because the UI is loaded from the server, UI changes reach the phone on the next app open. You
# only need to rebuild/reinstall the APK when NATIVE parts change (plugins, manifest, shortcuts).
#
# Prereqs on this machine (one-time):
#   - Android SDK at ~/Android (cmdline-tools + platforms;android-36 + build-tools;36.0.0)
#   - a FULL JDK 21 at ~/jdk (Temurin) — the system Java is a JRE (no javac)
# Plugin version fixes (Kotlin 1.9.25 + jvmTarget 17) are captured in web/patches via
# patch-package, re-applied automatically on npm install.
#
#   bash deploy/build-apk.sh                                   # real build, published for download
#   APK_SERVER_URL=http://10.0.2.2:3010 bash deploy/build-apk.sh   # emulator test build, not published
set -euo pipefail
cd "$(dirname "$0")/../web"

if [ -f ../.env ]; then set -a; . ../.env; set +a; fi
: "${COACH_PUBLIC_URL:?set COACH_PUBLIC_URL in .env, e.g. https://gym-coach.<your-tailnet>.ts.net}"
SERVER_URL="${APK_SERVER_URL:-$COACH_PUBLIC_URL}"
export COACH_PUBLIC_URL="$SERVER_URL"   # capacitor.config.ts reads it

export ANDROID_HOME="$HOME/Android" ANDROID_SDK_ROOT="$HOME/Android"
JDK="$(find "$HOME/jdk" -maxdepth 1 -name 'jdk-21*' -type d | head -1)"
[ -n "$JDK" ] || { echo "Need a full JDK 21 in ~/jdk (download Temurin 21)"; exit 1; }
export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"

# The offline page's "Try again" needs the live URL; generated, gitignored (it holds your host).
printf 'window.__GC_URL__ = %s;\n' "\"$SERVER_URL\"" > native-shell/config.js

npx cap sync android                                  # native shell + plugins (no web export)
( cd android && ./gradlew assembleDebug --no-daemon -q )
APK=android/app/build/outputs/apk/debug/app-debug.apk

if [ -n "${APK_SERVER_URL:-}" ]; then
  echo; echo "Test APK built for $SERVER_URL: web/$APK  (not published)"
  exit 0
fi

# Publish for sideloading. Next serves public/ files present at build time, so rebuild + restart.
cp "$APK" public/gym-coach.apk
npm run build >/dev/null
systemctl --user restart coach-frontend 2>/dev/null || true
echo
echo "APK built and published: $SERVER_URL/gym-coach.apk"
echo "On the computer, run:  python pair.py     (shows QR codes to install, pair and get alerts)"
