"""Phase-1 smoke test for PostgresCoachRepo.

Run against a throwaway local Postgres, e.g.:

    docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pw --name coachpg postgres:16
    python ingest.py                       # generates ./seed (or point COACH_SEED_DIR at it)
    COACH_DB_URI=postgresql://postgres:pw@localhost:5433/postgres \
    COACH_SEED_DIR=/mnt/user-data/outputs/seed \
    python -m coach.smoke_test

It applies migrations/001_core.sql, inserts a fixture user with a downward weight
trend and some logged training/nutrition, then calls every repo method and asserts the
results are sensible. NOT run in the build environment (no Postgres available there).
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import asyncpg

from .models import Targets
from .pg_repo import PostgresCoachRepo

HERE = Path(__file__).parent
DSN = os.environ["COACH_DB_URI"]
SEED_DIR = os.environ.get("COACH_SEED_DIR", str(HERE.parent / "seed"))


def _barbell_squat_id() -> str:
    exercises = json.loads((Path(SEED_DIR) / "exercises.seed.json").read_text())
    return next(e["id"] for e in exercises if e["name"] == "Barbell Squat")


async def seed_fixture(pool: asyncpg.Pool) -> tuple[str, str]:
    user_id = str(uuid.uuid4())
    squat_id = _barbell_squat_id()
    now = datetime.now(timezone.utc)

    async with pool.acquire() as con:
        async with con.transaction():
            await con.execute(
                """insert into profiles (user_id, sex, birth_year, height_cm, activity_level,
                       goal_weight_kg, weekly_rate_kg, medical_flags)
                   values ($1::uuid,'male',1990,180,'moderate',80,0.5,'[]'::jsonb)""",
                user_id,
            )
            # a gently downward weight trend across the last 4 weeks
            for i, w in enumerate([92.0, 91.6, 91.1, 90.7, 90.2, 89.9, 89.4, 89.0]):
                await con.execute(
                    "insert into body_metrics (user_id, recorded_at, weight_kg) values ($1::uuid,$2,$3)",
                    user_id, now - timedelta(days=28 - i * 4), w,
                )
            prog = await con.fetchval(
                """insert into programs (user_id, name, sessions_per_week, is_active)
                   values ($1::uuid,'Main',3,true) returning program_id""",
                user_id,
            )
            pe_id = await con.fetchval(
                """insert into program_exercises (program_id, exercise_id, position, sets, reps)
                   values ($1,$2,0,3,5) returning program_exercise_id""",
                prog, squat_id,
            )
            # 8 completed sessions in the last 28 days, with a few sets each
            for i in range(8):
                sid = await con.fetchval(
                    """insert into sessions (user_id, program_id, started_at, completed_at)
                       values ($1::uuid,$2,$3,$3) returning session_id""",
                    user_id, prog, now - timedelta(days=i * 3),
                )
                for _ in range(3):
                    await con.execute(
                        """insert into set_logs (session_id, user_id, exercise_id, reps, weight_kg, logged_at)
                           values ($1,$2::uuid,$3,5,100,$4)""",
                        sid, user_id, squat_id, now - timedelta(days=i * 3),
                    )
            for i in range(20):
                await con.execute(
                    """insert into nutrition_logs (user_id, logged_on, kcal, protein_g)
                       values ($1::uuid,$2,2100,150)""",
                    user_id, (now - timedelta(days=i)).date(),
                )
            await con.execute(
                """insert into targets (user_id, daily_kcal, protein_g, source, rationale)
                   values ($1::uuid,2200,160,'onboarding','baseline')""",
                user_id,
            )
    return user_id, pe_id and str(pe_id)


async def main() -> None:
    schema = (HERE / "migrations" / "001_core.sql").read_text()
    append_only = (HERE / "migrations" / "003_targets_append_only.sql").read_text()
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=5)
    await pool.execute(schema)
    await pool.execute(append_only)

    user_id, pe_id = await seed_fixture(pool)
    repo = PostgresCoachRepo(pool, __import__("coach.catalog", fromlist=["CatalogVariantIndex"])
                             .CatalogVariantIndex.from_seed(SEED_DIR))

    profile = await repo.get_profile(user_id)
    assert profile.sex.value == "male"

    trend = await repo.get_weight_trend(user_id, 30)
    assert trend.n_points >= 8
    assert trend.smoothed_slope_kg_per_week is not None and trend.smoothed_slope_kg_per_week < 0
    print(f"trend: n={trend.n_points} slope/wk={trend.smoothed_slope_kg_per_week:.3f} "
          f"start={trend.start_kg} latest={trend.latest_kg}")

    adh = await repo.get_adherence(user_id, 28)
    assert adh.sessions_completed == 8 and adh.sets_completed == 24
    print(f"adherence: sessions {adh.sessions_completed}/{adh.sessions_prescribed} "
          f"sets {adh.sets_completed}/{adh.sets_prescribed}")

    nut = await repo.get_nutrition_summary(user_id, 14)
    assert nut.days_logged > 0 and nut.avg_kcal is not None
    print(f"nutrition: days={nut.days_logged} avg_kcal={nut.avg_kcal:.0f} target={nut.target_kcal}")

    cur = await repo.get_current_targets(user_id)
    assert cur is not None
    new = await repo.insert_target(user_id, Targets(
        daily_kcal=2100, protein_g=160, source="coach_chat", rationale="smoke"))
    assert (await repo.get_current_targets(user_id)).target_id == new.target_id

    program = await repo.get_program_exercises(user_id)
    assert program and program[0].name == "Barbell Squat"
    print(f"program slot: {program[0].name} ({program[0].equipment})")

    variant = await repo.find_equipment_variant(program[0].exercise_id, {"none"})
    assert variant is not None
    print(f"swap with no equipment: {program[0].name} -> {variant.name}")

    rid = await repo.record_review(user_id, "on_track", "looking good", {"target_change": None})
    assert rid

    # --- hardening checks (003 + loud scoping) -------------------------------
    try:
        await pool.execute(
            "update targets set rationale = 'tamper' where user_id = $1::uuid", user_id
        )
        raise AssertionError("targets UPDATE should have been blocked by trigger")
    except asyncpg.PostgresError:
        print("append-only targets: UPDATE blocked as expected")

    intruder = str(uuid.uuid4())
    await pool.execute(
        """insert into profiles (user_id, sex, birth_year, height_cm, activity_level,
               goal_weight_kg, weekly_rate_kg, medical_flags)
           values ($1::uuid,'female',1992,165,'light',60,0.3,'[]'::jsonb)""",
        intruder,
    )
    from .models import ProgramExerciseEdit, ProposedProgramChange  # local import: smoke-only

    try:
        await repo.apply_program_change(
            intruder,
            ProposedProgramChange(
                edits=[ProgramExerciseEdit(program_exercise_id=pe_id, sets=99)],
                rationale="intrusion attempt",
            ),
        )
        raise AssertionError("cross-user program edit should have raised PermissionError")
    except PermissionError:
        print("cross-user program edit: refused as expected")
    untouched = await pool.fetchval(
        "select sets from program_exercises where program_exercise_id = $1::uuid", pe_id
    )
    assert untouched == 3, "intruder edit must not change the row"

    print("\nALL SMOKE CHECKS PASSED")
    await repo.close()


if __name__ == "__main__":
    asyncio.run(main())
