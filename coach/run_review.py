"""Weekly-review batch runner — the scheduler entrypoint.

Runs the proactive weekly review (coach/review.py) for every onboarded user, writing
a `coach_review` row each user sees on next open. Invoked by a scheduler (systemd timer
/ cron), NOT a user request — so it talks to the data layer + review graph directly
rather than going through the HTTP endpoint, and needs no bearer token.

    python -m coach.run_review                # all users, 7-day window
    python -m coach.run_review --window-days 14
    python -m coach.run_review --user <uuid>  # a single user

Reads the same env as the service: COACH_DB_URI, COACH_SEED_DIR, COACH_MODEL (+ the
provider env, e.g. OPENAI_BASE_URL/OPENAI_API_KEY for the CLI proxy). Exit code is 0
only if every selected user's review succeeded, so the scheduler surfaces failures.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

from .pg_repo import PostgresCoachRepo
from .review import build_review_graph

logger = logging.getLogger("coach.run_review")


async def _list_user_ids(repo: PostgresCoachRepo) -> list[str]:
    rows = await repo._pool.fetch("select user_id from profiles order by user_id")
    return [str(r["user_id"]) for r in rows]


async def run(window_days: int, only_user: str | None) -> int:
    dsn = os.environ["COACH_DB_URI"]
    seed_dir = os.environ.get("COACH_SEED_DIR", "./seed")
    model_id = os.environ.get("COACH_MODEL", "google_genai:gemini-3.5-flash")

    repo = await PostgresCoachRepo.create(dsn, seed_dir)
    try:
        review = build_review_graph(repo, model_id=model_id)
        user_ids = [only_user] if only_user else await _list_user_ids(repo)
        if not user_ids:
            logger.info("no onboarded users — nothing to review")
            return 0

        failures = 0
        for uid in user_ids:
            try:
                out = await review.ainvoke(
                    {"user_id": uid, "window_days": window_days, "committed_changes": {}}
                )
                a = out["assessment"]
                changes = out["committed_changes"]
                note = ""
                if changes.get("target_change"):
                    note = " (target adjusted)"
                elif changes.get("target_change_blocked"):
                    note = " (target change advised, not applied)"
                logger.info("reviewed %s: status=%s%s", uid, a.get("status"), note)
            except Exception:
                failures += 1
                logger.exception("review FAILED for user %s", uid)

        logger.info(
            "weekly review complete: %d ok, %d failed (window=%dd)",
            len(user_ids) - failures, failures, window_days,
        )
        return 1 if failures else 0
    finally:
        await repo.close()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    p = argparse.ArgumentParser(description="Run the weekly coach review for users.")
    p.add_argument("--window-days", type=int, default=7, help="review window (default 7)")
    p.add_argument("--user", default=None, help="restrict to a single user_id (UUID)")
    args = p.parse_args()
    sys.exit(asyncio.run(run(args.window_days, args.user)))


if __name__ == "__main__":
    main()
