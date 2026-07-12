"""DB integration tests for the backend logic that actually misfired in production —
set-sync self-heal, the schedule filter, multi-program adherence, exercise consistency, and
partial measurement upsert. Run against a live coachdb; SKIPPED when COACH_DB_URI is unset (so
the default no-DB suite stays green). Everything runs under a throwaway user that is
cascade-deleted afterward, so real data is never touched.
"""
import asyncio
import contextlib
import datetime as dt
import os
import uuid

import pytest

DSN = os.environ.get("COACH_DB_URI")
SEED = os.environ.get("COACH_SEED_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "seed"))
pytestmark = pytest.mark.skipif(not DSN, reason="COACH_DB_URI not set (DB integration test)")


@contextlib.asynccontextmanager
async def throwaway_repo():
    import asyncpg
    from coach.catalog import CatalogVariantIndex
    from coach.pg_repo import PostgresCoachRepo

    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=3)
    repo = PostgresCoachRepo(pool, CatalogVariantIndex.from_seed(SEED))
    uid = str(uuid.uuid4())
    await repo.create_profile(uid, sex="male", birth_year=1990, height_cm=175,
                              activity_level="moderate", goal_weight_kg=75, weekly_rate_kg=0.5, medical_flags=[])
    try:
        yield repo, uid, pool
    finally:
        await pool.execute("delete from profiles where user_id = $1::uuid", uid)  # cascade
        await pool.close()


def _utc(y, m, d):
    return dt.datetime(y, m, d, 12, 0, tzinfo=dt.timezone.utc)


def test_setsync_self_heals_missing_session():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            await repo.add_program(uid, "T", 3, [{"exercise_id": "Barbell_Squat", "sets": 3, "reps": 5}])
            sid, setid = str(uuid.uuid4()), str(uuid.uuid4())
            # session was never created -> insert_set_logs must self-heal (create it) and log the set
            n = await repo.insert_set_logs(uid, sid, [{"id": setid, "exercise_id": "Barbell_Squat",
                                                       "reps": 5, "weight_kg": 60, "logged_at": _utc(2026, 6, 20)}])
            assert n == 1  # would have raised PermissionError before the self-heal fix
    asyncio.run(go())


def test_schedule_filter_respects_weekday():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            pid = await repo.add_program(uid, "Sched", 3, [{"exercise_id": "Plank", "sets": 3, "reps": 1}])
            pg_today = (dt.date.today().weekday() + 1) % 7  # python Mon=0 -> pg Sun=0
            other = [(pg_today + 1) % 7, (pg_today + 2) % 7]
            await repo.set_program_schedule(uid, pid, other)
            assert not any(s["program_id"] == pid for s in await repo.get_program_slots(uid, scheduled_only=True))
            await repo.set_program_schedule(uid, pid, [pg_today])
            assert any(s["program_id"] == pid for s in await repo.get_program_slots(uid, scheduled_only=True))
    asyncio.run(go())


def test_adherence_sums_across_active_programs():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            await repo.add_program(uid, "A", 3, [{"exercise_id": "Plank", "sets": 3, "reps": 1},
                                                 {"exercise_id": "Pullups", "sets": 3, "reps": 8}])  # 6 sets/session
            await repo.add_program(uid, "B", 2, [{"exercise_id": "Barbell_Squat", "sets": 5, "reps": 5}])  # 5 sets/session
            a = await repo.get_adherence(uid, 7)
            assert a.sessions_prescribed == 5              # (3 + 2) sessions/week * 1 week
            assert a.sets_prescribed == 28                 # 3*6 + 2*5
    asyncio.run(go())


def test_exercise_consistency_counts_distinct_days():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            await repo.add_program(uid, "P", 7, [{"exercise_id": "Kegel_Hold_Slow", "sets": 1, "reps": 10}])
            sid = str(uuid.uuid4())
            await repo.insert_set_logs(uid, sid, [
                {"id": str(uuid.uuid4()), "exercise_id": "Kegel_Hold_Slow", "reps": 10, "weight_kg": 0, "logged_at": _utc(2026, 6, 20)},
                {"id": str(uuid.uuid4()), "exercise_id": "Kegel_Hold_Slow", "reps": 10, "weight_kg": 0, "logged_at": _utc(2026, 6, 21)},
            ])
            c = await repo.get_exercise_consistency(uid, ["Kegel_Hold_Slow"], 3650)
            assert c["days_logged"] == 2 and c["total_sets"] == 2
    asyncio.run(go())


def test_update_program_edits_in_place_without_touching_others():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            pid_a = await repo.add_program(uid, "A", 3, [{"exercise_id": "Plank", "sets": 3, "reps": 1}])
            pid_b = await repo.add_program(uid, "B", 7, [{"exercise_id": "Kegel_Hold_Slow", "sets": 3, "reps": 10}])
            await repo.update_program_exercises(uid, pid_a, "A2", 4,
                                                [{"exercise_id": "Barbell_Squat", "sets": 5, "reps": 5}])
            progs = {p["program_id"]: p for p in await repo.list_programs(uid)}
            # edited program updated in place…
            assert progs[pid_a]["name"] == "A2" and progs[pid_a]["exercises"] == 1
            # …and the OTHER program is completely untouched and still active (the old replace-all
            # editor deactivated everything — this is the regression test for that landmine)
            assert progs[pid_b]["is_active"] and progs[pid_b]["name"] == "B"
            detail = await repo.get_program_detail(uid, pid_a)
            assert [e["exercise_id"] for e in detail["exercises"]] == ["Barbell_Squat"]
    asyncio.run(go())


def test_update_program_rejects_foreign_program():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            with pytest.raises(PermissionError):
                await repo.update_program_exercises(uid, str(uuid.uuid4()), "X", 3,
                                                    [{"exercise_id": "Plank", "sets": 1, "reps": 1}])
    asyncio.run(go())


def test_measurement_partial_upsert_keeps_other_fields():
    async def go():
        async with throwaway_repo() as (repo, uid, _pool):
            day = dt.date(2026, 1, 1)
            await repo.upsert_measurement(uid, day, {"waist_cm": 90, "belly_cm": 95})
            await repo.upsert_measurement(uid, day, {"waist_cm": 88})  # partial edit
            m = [x for x in await repo.get_measurements(uid) if x["date"] == "2026-01-01"][0]
            assert m["waist_cm"] == 88 and m["belly_cm"] == 95   # COALESCE preserved belly
            assert await repo.delete_measurement(uid, day) == 1
    asyncio.run(go())
