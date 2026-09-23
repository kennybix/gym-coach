"""Daily job: one calm morning nudge per user, plus housekeeping.

The adaptive engine and the weekly review need data, and the data stopped flowing because nothing
ever reached out. This sends at most ONE notification a day, and only when there is something to
do: a workout scheduled today, and/or no weigh-in for a couple of days. Tapping it opens the app on
the right screen (a workout, or the weigh-in sheet).

Wellbeing rules (deliberate — see CLAUDE.md safety invariants):
  * Users who disclosed an eating-disorder history never get weigh-in prompts. Frequent weighing
    prompts are exactly the wrong nudge for them; they may still get a training reminder.
  * It backs off. After 14 days with no logging at all, it only nudges on Mondays with a
    fresh-start message instead of a daily reminder of what hasn't happened.
  * No numbers, no streak-loss language, no guilt.

Housekeeping: sessions left open for more than 12 hours are closed at their last logged set;
open sessions with no sets at all are removed (they only clutter history).

    python -m coach.daily               # nudge + housekeeping
    python -m coach.daily --dry-run     # print what it would send, change nothing
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from . import notify
from .pg_repo import PostgresCoachRepo

logger = logging.getLogger("coach.daily")

WEIGH_IN_GAP_DAYS = 2        # nudge when the last weigh-in is at least this old
DORMANT_AFTER_DAYS = 14      # beyond this, nudge only on Mondays
STALE_SESSION_HOURS = 12


@dataclass
class Snapshot:
    ed_history: bool
    workout_name: Optional[str]
    workout_exercises: int
    workout_minutes: int
    last_weigh_in: Optional[date]
    last_activity: Optional[date]


@dataclass
class Nudge:
    title: str
    message: str
    click_key: str
    actions: list[tuple[str, str]]  # (label, link key)


def plan_nudge(s: Snapshot, today: date) -> Optional[Nudge]:
    """Pure decision: what (if anything) to send today. Unit-tested."""
    inactive = (today - s.last_activity).days if s.last_activity else 10_000
    dormant = inactive >= DORMANT_AFTER_DAYS
    if dormant and today.weekday() != 0:
        return None  # back off: Mondays only once someone has gone quiet

    wants_weigh_in = (
        not s.ed_history
        and (s.last_weigh_in is None or (today - s.last_weigh_in).days >= WEIGH_IN_GAP_DAYS)
    )
    has_workout = s.workout_exercises > 0

    if not wants_weigh_in and not has_workout:
        return None

    lines, actions = [], []
    if has_workout:
        name = s.workout_name or "your workout"
        lines.append(f"Today: {name} · {s.workout_exercises} exercise{'s' if s.workout_exercises != 1 else ''}"
                     f" · about {s.workout_minutes} min.")
        actions.append(("Start workout", "workout"))
    if wants_weigh_in:
        lines.append("A quick weigh-in keeps your trend honest.")
        actions.append(("Weigh in", "weight"))

    if dormant:
        title = "New week, fresh start"
        lines.insert(0, "No catching up needed — just start from today.")
    else:
        title = "Good morning"
    return Nudge(title=title, message="\n".join(lines),
                 click_key="workout" if has_workout else "weight", actions=actions)


async def snapshot(repo: PostgresCoachRepo, uid: str) -> Snapshot:
    profile = await repo.get_profile(uid)
    slots = await repo.get_program_slots(uid, scheduled_only=True)
    names = [s.get("program_name") for s in slots if s.get("program_name")]
    sets = sum(1 if s.get("category") == "cardio" else (s.get("sets") or 3) for s in slots)
    minutes = max(5, round(sum(20 if s.get("category") == "cardio" else (s.get("sets") or 3) * 2.25
                               for s in slots) / 5) * 5) if slots else 0
    lw = await repo.get_latest_weight(uid)
    last_activity = await repo._pool.fetchval(
        """select greatest(
             (select max(logged_at)::date from set_logs where user_id = $1::uuid),
             (select max(recorded_at)::date from body_metrics where user_id = $1::uuid),
             (select max(logged_on) from nutrition_logs where user_id = $1::uuid),
             (select max(recorded_at)::date from vitals where user_id = $1::uuid))""",
        uid,
    )
    return Snapshot(
        ed_history="eating_disorder_history" in profile.medical_flags,
        workout_name=" + ".join(dict.fromkeys(names)) or None,
        workout_exercises=len(slots),
        workout_minutes=minutes if sets else 0,
        last_weigh_in=date.fromisoformat(lw["date"]) if lw else None,
        last_activity=last_activity,
    )


async def housekeeping(repo: PostgresCoachRepo, dry_run: bool) -> tuple[int, int]:
    """Close stale open sessions that have sets; delete stale open sessions that don't."""
    cutoff = f"{STALE_SESSION_HOURS} hours"
    if dry_run:
        closed = await repo._pool.fetchval(
            f"""select count(*) from sessions s where completed_at is null
                and started_at < now() - interval '{cutoff}'
                and exists (select 1 from set_logs l where l.session_id = s.session_id)""")
        removed = await repo._pool.fetchval(
            f"""select count(*) from sessions s where completed_at is null
                and started_at < now() - interval '{cutoff}'
                and not exists (select 1 from set_logs l where l.session_id = s.session_id)""")
        return closed, removed
    closed = await repo._pool.execute(
        f"""update sessions s set completed_at = (
                select max(l.logged_at) from set_logs l where l.session_id = s.session_id)
            where completed_at is null and started_at < now() - interval '{cutoff}'
              and exists (select 1 from set_logs l where l.session_id = s.session_id)""")
    removed = await repo._pool.execute(
        f"""delete from sessions s where completed_at is null
              and started_at < now() - interval '{cutoff}'
              and not exists (select 1 from set_logs l where l.session_id = s.session_id)""")
    return int(closed.split()[-1]), int(removed.split()[-1])


async def run(dry_run: bool, nudge: bool) -> int:
    repo = await PostgresCoachRepo.create(os.environ["COACH_DB_URI"], os.environ.get("COACH_SEED_DIR", "./seed"))
    try:
        closed, removed = await housekeeping(repo, dry_run)
        logger.info("housekeeping: %d stale sessions closed, %d empty ones removed%s",
                    closed, removed, " (dry run)" if dry_run else "")
        if not nudge:
            return 0
        today = date.today()
        for r in await repo._pool.fetch("select user_id from profiles order by user_id"):
            uid = str(r["user_id"])
            if not notify.wants(uid):
                continue
            try:
                n = plan_nudge(await snapshot(repo, uid), today)
            except Exception:  # noqa: BLE001
                logger.exception("nudge planning failed for %s", uid)
                continue
            if n is None:
                logger.info("no nudge for %s today", uid)
                continue
            if dry_run:
                print(f"[{uid}] {n.title}\n  {n.message.replace(chr(10), chr(10) + '  ')}\n  "
                      f"actions: {[a[0] for a in n.actions]}")
                continue
            notify.send(n.title, n.message, click=notify.link(n.click_key),
                        actions=[{"label": lbl, "url": notify.link(k)} for lbl, k in n.actions],
                        tags=["sunrise"], priority=3)
        return 0
    finally:
        await repo.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Daily nudge + housekeeping.")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-nudge", action="store_true", help="housekeeping only")
    a = p.parse_args()
    sys.exit(asyncio.run(run(a.dry_run, not a.no_nudge)))


if __name__ == "__main__":
    main()
