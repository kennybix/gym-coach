#!/usr/bin/env python3
"""Set up (or re-connect) your phone by scanning QR codes — no typing tokens on a phone.

    python pair.py                 # all three: install the app, get notifications, sign in
    python pair.py --sign-in       # just the sign-in code (e.g. after rotating the secret)
    python pair.py --user <uuid>   # sign in as a specific account

Reads the repo's .env (SUPABASE_JWT_SECRET, COACH_PUBLIC_URL, COACH_NTFY_*). Run it in a terminal
on this computer; the codes appear in the terminal and are never written to disk.

1. Install the app   — opens the APK download (Tailscale must be on on the phone).
2. Notifications     — subscribes the ntfy app to your private topic: weekly reviews, morning
                       nudges, and alerts if something on the server breaks.
3. Sign in           — scan with the app's "Scan pairing code" button (Home or Setup), or with the
                       camera, which opens the browser version. This code IS your login: don't
                       share or screenshot it. Rotating SUPABASE_JWT_SECRET invalidates it.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent


def load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def show(title: str, payload: str, note: str) -> None:
    import segno

    print(f"\n\033[1m{title}\033[0m")
    print(note)
    segno.make(payload, error="m").terminal(compact=True)


def mint(uid: str, days: int) -> str:
    import jwt

    secret = os.environ.get("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        sys.exit("SUPABASE_JWT_SECRET is not set (in .env) — can't sign a token.")
    return jwt.encode({"sub": uid, "aud": "authenticated", "exp": int(time.time()) + days * 86400},
                      secret, algorithm="HS256")


def main() -> None:
    load_env()
    p = argparse.ArgumentParser(description="Show QR codes to set up the phone.")
    p.add_argument("--sign-in", action="store_true", help="only the sign-in code")
    p.add_argument("--user", default=None, help="account id (default: COACH_NOTIFY_USERS' first entry)")
    p.add_argument("--days", type=int, default=365, help="token lifetime in days (default 365)")
    a = p.parse_args()

    base = os.environ.get("COACH_PUBLIC_URL", "").rstrip("/")
    if not base:
        sys.exit("COACH_PUBLIC_URL is not set (in .env), e.g. https://gym-coach.<your-tailnet>.ts.net")
    uid = a.user or next((u.strip() for u in os.environ.get("COACH_NOTIFY_USERS", "").split(",") if u.strip()), None)
    if not uid:
        sys.exit("Pass --user <account-id> (or set COACH_NOTIFY_USERS in .env).")

    print("Point the phone's camera at each code in turn. Tailscale must be ON on the phone.")

    if not a.sign_in:
        apk = ROOT / "web" / "public" / "gym-coach.apk"
        if apk.exists():
            show("1 · Install the app",
                 f"{base}/gym-coach.apk",
                 "Downloads the Android app. Open the file to install it (allow installs from your browser\n"
                 "once). Installing over the old app is fine — your logs live on the server; you'll just\n"
                 "sign in again with code 3.")
        else:
            print("\n1 · Install the app — skipped: no APK published yet. Run: bash deploy/build-apk.sh")

        ntfy_url = os.environ.get("COACH_NTFY_URL", "").rstrip("/")
        topic = os.environ.get("COACH_NTFY_TOPIC", "").strip()
        if ntfy_url and topic:
            host = urlparse(ntfy_url).netloc
            show("2 · Notifications (weekly review, morning nudges, alerts)",
                 f"ntfy://{host}/{topic}",
                 "Install 'ntfy' from the Play Store first, then scan this to subscribe. If the scan doesn't\n"
                 f"open ntfy, add it by hand: server {ntfy_url}  ·  topic {topic}\n"
                 "In ntfy's settings, allow it to run in the background so messages arrive instantly.")
        else:
            print("\n2 · Notifications — skipped: COACH_NTFY_URL / COACH_NTFY_TOPIC not set. See deploy/NOTIFICATIONS.md")

    token = mint(uid, a.days)
    show("3 · Sign in",
         f"{base}/pair#t={token}",
         "In the app: Home (or Setup → Signed in) → 'Scan pairing code', then scan this.\n"
         "\033[33mThis code is your login. Don't share it or screenshot it.\033[0m")
    print()


if __name__ == "__main__":
    main()
