"""Weekly-review batch runner — the scheduler entrypoint.

Runs the proactive weekly review (coach/review.py) for every onboarded user, records a
`coach_review` row, and pushes the result to the phone (coach/notify.py) so the review reaches the
user instead of waiting in an app they may not open.

Self-healing schedule: the systemd timer fires DAILY with `--if-missing`, which reviews only users
who have no review yet this ISO week. Monday's run does the work; if every model is down on Monday
(it happened: a 128-hour provider cooldown on 2026-09-21), Tuesday's run catches up — no manual step.

    python -m coach.run_review                     # all users, 7-day window, unconditionally
    python -m coach.run_review --if-missing        # only users without a review this week
    python -m coach.run_review --user <uuid>       # a single user
    python -m coach.run_review --no-notify         # don't push

Exit codes: 0 when every selected user was reviewed OR the only failures were "coach offline"
(expected, alerted, retried tomorrow); 1 on an unexpected error, so systemd's OnFailure= alert fires
for genuine bugs.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from . import llm, notify
from .pg_repo import PostgresCoachRepo
from .review import build_review_graph

logger = logging.getLogger("coach.run_review")

STATE_FILE = Path(os.environ.get("COACH_STATE_DIR", Path.home() / ".local/share/gym-coach")) / "review_state.json"

HEADLINE = {
    "on_track": "On track",
    "ahead": "Ahead of plan",
    "behind": "A little behind",
    "stalled": "Stalled this week",
    "insufficient_data": "Not enough logged yet",
}


def week_start(today: date | None = None) -> date:
    today = today or date.today()
    return today - timedelta(days=today.weekday())  # Monday


async def _list_user_ids(repo: PostgresCoachRepo) -> list[str]:
    rows = await repo._pool.fetch("select user_id from profiles order by user_id")
    return [str(r["user_id"]) for r in rows]


async def _reviewed_since(repo: PostgresCoachRepo, uid: str, since: date) -> bool:
    return bool(await repo._pool.fetchval(
        "select 1 from coach_reviews where user_id = $1::uuid and created_at >= $2::date limit 1",
        uid, since,
    ))


def _load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:  # noqa: BLE001
        return {}


def _save_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state))
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not save review state: %s", exc)


def review_notification(status: str, summary: str, changes: dict) -> tuple[str, str]:
    """(title, message) for the phone. Kept pure for testing."""
    title = f"Weekly review · {HEADLINE.get(status, status.replace('_', ' ').title())}"
    msg = summary.strip()
    tc = changes.get("target_change") if isinstance(changes, dict) else None
    if tc and tc.get("new_daily_kcal"):
        prev = tc.get("previous_daily_kcal")
        msg += f"\n\nTarget recalibrated: {prev} → {tc['new_daily_kcal']} kcal/day." if prev else \
               f"\n\nTarget recalibrated to {tc['new_daily_kcal']} kcal/day."
    return title, msg


async def run(window_days: int, only_user: str | None, if_missing: bool, push: bool) -> int:
    dsn = os.environ["COACH_DB_URI"]
    seed_dir = os.environ.get("COACH_SEED_DIR", "./seed")

    repo = await PostgresCoachRepo.create(dsn, seed_dir)
    try:
        review = build_review_graph(repo, model=llm.build_model(temperature=0.2))
        user_ids = [only_user] if only_user else await _list_user_ids(repo)
        if not user_ids:
            logger.info("no onboarded users — nothing to review")
            return 0

        monday = week_start()
        done, offline, broken = 0, [], 0
        for uid in user_ids:
            if if_missing and await _reviewed_since(repo, uid, monday):
                logger.info("skip %s: already reviewed this week", uid)
                continue
            try:
                out = await review.ainvoke({"user_id": uid, "window_days": window_days, "committed_changes": {}})
            except llm.CoachUnavailable as exc:
                offline.append(exc.retry_at)
                logger.warning("review deferred for %s: coach offline (%s)", uid, exc)
                continue
            except Exception:  # noqa: BLE001
                broken += 1
                logger.exception("review FAILED for user %s", uid)
                continue
            done += 1
            a, changes = out["assessment"], out["committed_changes"]
            status = a.get("status")
            status = getattr(status, "value", status)
            logger.info("reviewed %s: status=%s%s", uid, status,
                        " (target adjusted)" if changes.get("target_change") else "")
            if push and notify.wants(uid):
                title, msg = review_notification(status, a.get("summary", ""), changes)
                notify.send(title, msg, click=notify.link("coach"), tags=["clipboard"])

        if offline and push:
            # Alert once per week, not every day the outage lasts.
            state = _load_state()
            key = monday.isoformat()
            if state.get("offline_alerted_week") != key:
                soon = min((t for t in offline if t), default=None)
                when = datetime.fromtimestamp(soon).strftime("%A %-I:%M %p") if soon else None
                notify.send(
                    "Weekly review delayed",
                    ("Every AI model the coach can use is rate-limited"
                     + (f" until about {when}" if when else "") +
                     ". I'll run your review automatically as soon as one is back. Logging still works."),
                    click=notify.link("coach"), tags=["hourglass"], priority=2,
                )
                state["offline_alerted_week"] = key
                _save_state(state)

        logger.info("weekly review: %d reviewed, %d deferred (coach offline), %d failed (window=%dd)",
                    done, len(offline), broken, window_days)
        return 1 if broken else 0
    finally:
        await repo.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Run the weekly coach review for users.")
    p.add_argument("--window-days", type=int, default=7, help="review window (default 7)")
    p.add_argument("--user", default=None, help="restrict to a single user_id (UUID)")
    p.add_argument("--if-missing", action="store_true",
                   help="only review users with no review since this Monday (daily catch-up)")
    p.add_argument("--no-notify", action="store_true", help="don't push the result to the phone")
    args = p.parse_args()
    sys.exit(asyncio.run(run(args.window_days, args.user, args.if_missing, not args.no_notify)))


if __name__ == "__main__":
    main()
