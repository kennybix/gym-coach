"""Push notifications to the phone via a self-hosted ntfy server on the tailnet.

The app used to wait for the user to open it: the weekly review landed in a screen nobody was
looking at, and a failed review was silent. This is the one channel the server uses to reach the
phone — the weekly review, gentle daily nudges, and operational alerts (a job failed, the coach is
offline). It stays private: ntfy runs on this machine and is only reachable over Tailscale.

Config (env):
    COACH_NTFY_URL     base URL of the ntfy server, e.g. https://gym-coach.<tailnet>.ts.net:8443
                       (the backend publishes via COACH_NTFY_PUBLISH_URL if set, else this)
    COACH_NTFY_TOPIC   an unguessable topic name (the phone subscribes to it)
    COACH_PUBLIC_URL   where the app is served; used for tap-to-open links

Unconfigured -> every call is a logged no-op. A notification failure never breaks the caller.

CLI (used by systemd OnFailure= and for testing):
    python -m coach.notify --title "…" --message "…" [--click URL] [--priority 4] [--tags warning]
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Optional

import httpx

logger = logging.getLogger("coach.notify")


def _publish_url() -> Optional[str]:
    base = (os.environ.get("COACH_NTFY_PUBLISH_URL") or os.environ.get("COACH_NTFY_URL") or "").rstrip("/")
    topic = os.environ.get("COACH_NTFY_TOPIC", "").strip()
    if not base or not topic:
        return None
    return f"{base}/{topic}"


def configured() -> bool:
    return _publish_url() is not None


def wants(user_id: str) -> bool:
    """The topic belongs to one phone. COACH_NOTIFY_USERS (comma-separated user ids) limits which
    accounts' reviews/nudges are pushed to it; empty = every account (single-user default)."""
    allow = [u.strip() for u in os.environ.get("COACH_NOTIFY_USERS", "").split(",") if u.strip()]
    return not allow or user_id in allow


def app_url(path: str = "/") -> Optional[str]:
    base = os.environ.get("COACH_PUBLIC_URL", "").rstrip("/")
    return f"{base}{path}" if base else None


# Where a tap should land. The Android app registers the `gymcoach://` scheme, so a tap opens the
# app itself (on the right sheet). Set COACH_NOTIFY_LINKS=web to open the PWA in the browser instead.
_APP_LINKS = {
    "home": "gymcoach://home", "coach": "gymcoach://coach", "workout": "gymcoach://workout",
    "weight": "gymcoach://log/weight", "bp": "gymcoach://log/bp", "food": "gymcoach://food",
}
_WEB_PATHS = {
    "home": "/", "coach": "/coach", "workout": "/workout",
    "weight": "/?log=weight", "bp": "/?log=bp", "food": "/nutrition?add=1",
}


def link(key: str) -> Optional[str]:
    """Tap target for a notification: the app's deep link, or the PWA URL."""
    if os.environ.get("COACH_NOTIFY_LINKS", "app").lower() == "web":
        return app_url(_WEB_PATHS[key])
    return _APP_LINKS[key]


def send(
    title: str,
    message: str,
    *,
    click: Optional[str] = None,
    actions: Optional[list[dict]] = None,
    tags: Optional[list[str]] = None,
    priority: int = 3,
    timeout: float = 10.0,
) -> bool:
    """Publish one notification. Returns True if the server accepted it.

    `actions`: up to three ntfy "view" actions, e.g. [{"label": "Weigh in", "url": "gymcoach://log/weight"}].
    """
    url = _publish_url()
    if not url:
        logger.info("ntfy not configured; skipped notification %r", title)
        return False
    payload: dict = {
        "topic": url.rsplit("/", 1)[1],
        "title": title[:250],
        "message": message[:3500],
        "priority": max(1, min(5, priority)),
    }
    if tags:
        payload["tags"] = tags
    if click:
        payload["click"] = click
    if actions:
        payload["actions"] = [
            {"action": "view", "label": a["label"][:40], "url": a["url"], "clear": True}
            for a in actions[:3]
        ]
    base = url.rsplit("/", 1)[0]
    try:
        # JSON publishing goes to the server root with the topic in the body.
        r = httpx.post(base, json=payload, timeout=timeout)
        if r.status_code >= 300:
            logger.warning("ntfy publish failed: %s %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001 — a notification must never break the caller
        logger.warning("ntfy publish error: %s", exc)
        return False


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Send a push notification to the phone (ntfy).")
    p.add_argument("--title", required=True)
    p.add_argument("--message", required=True)
    p.add_argument("--click", default=None)
    p.add_argument("--priority", type=int, default=3)
    p.add_argument("--tags", default="", help="comma-separated ntfy tags/emoji shortcodes")
    a = p.parse_args()
    ok = send(a.title, a.message, click=a.click, priority=a.priority,
              tags=[t for t in a.tags.split(",") if t] or None)
    sys.exit(0 if ok or not configured() else 1)


if __name__ == "__main__":
    main()
