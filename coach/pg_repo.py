"""PostgreSQL implementation of CoachRepo (asyncpg).

User data lives in Postgres; the static exercise catalog is seed-loaded into a
CatalogVariantIndex (so name/equipment lookups and variant resolution don't need
catalog tables). Every query is scoped by a verified user_id passed in from the
service layer — the agent never supplies it.

NOTE: validated against live Postgres 16 via smoke_test.py (migrations 001 + 003):
trend regression, adherence math, nutrition aggregation, catalog variant swap,
append-only targets trigger, and cross-user edit refusal all verified passing.
"""
from __future__ import annotations

import json
from typing import Optional

import asyncpg

from .catalog import CatalogVariantIndex
from .models import (
    AdherenceSummary,
    NutritionSummary,
    Profile,
    ProgramExerciseRef,
    ProposedProgramChange,
    Targets,
    VariantMatch,
    WeightTrend,
)


def _as_list(v) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else json.loads(v)


class PostgresCoachRepo:
    """Implements the CoachRepo protocol."""

    def __init__(self, pool: asyncpg.Pool, catalog: CatalogVariantIndex) -> None:
        self._pool = pool
        self._catalog = catalog

    @classmethod
    async def create(cls, dsn: str, seed_dir: str) -> "PostgresCoachRepo":
        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
        return cls(pool, CatalogVariantIndex.from_seed(seed_dir))

    async def close(self) -> None:
        await self._pool.close()

    # --- profile -------------------------------------------------------------
    async def get_profile(self, user_id: str) -> Profile:
        row = await self._pool.fetchrow(
            "select * from profiles where user_id = $1::uuid", user_id
        )
        if row is None:
            raise LookupError(f"No profile for user {user_id}")
        return Profile(
            user_id=str(row["user_id"]),
            sex=row["sex"],
            birth_year=row["birth_year"],
            height_cm=float(row["height_cm"]),
            activity_level=row["activity_level"],
            goal_weight_kg=float(row["goal_weight_kg"]),
            weekly_rate_kg=float(row["weekly_rate_kg"]),
            medical_flags=_as_list(row["medical_flags"]),
            current_target_id=str(row["current_target_id"]) if row["current_target_id"] else None,
        )

    # --- weight trend (smoothed via linear regression) -----------------------
    async def get_weight_trend(self, user_id: str, window_days: int) -> WeightTrend:
        row = await self._pool.fetchrow(
            """
            select
                count(*)                                                   as n,
                (array_agg(weight_kg order by recorded_at asc))[1]         as start_kg,
                (array_agg(weight_kg order by recorded_at desc))[1]        as latest_kg,
                regr_slope(weight_kg, extract(epoch from recorded_at)/86400.0) as slope_per_day
            from body_metrics
            where user_id = $1::uuid
              and weight_kg is not null
              and recorded_at >= now() - make_interval(days => $2::int)
            """,
            user_id,
            window_days,
        )
        slope = row["slope_per_day"]
        return WeightTrend(
            window_days=window_days,
            start_kg=float(row["start_kg"]) if row["start_kg"] is not None else None,
            latest_kg=float(row["latest_kg"]) if row["latest_kg"] is not None else None,
            smoothed_slope_kg_per_week=float(slope) * 7 if slope is not None else None,
            n_points=row["n"] or 0,
        )

    # --- adherence (prescribed vs actual) ------------------------------------
    async def get_adherence(self, user_id: str, window_days: int) -> AdherenceSummary:
        weeks = window_days / 7.0
        prog = await self._pool.fetchrow(
            """
            select p.sessions_per_week,
                   coalesce(sum(pe.sets), 0) as sets_per_session
            from programs p
            left join program_exercises pe on pe.program_id = p.program_id
            where p.user_id = $1::uuid and p.is_active
            group by p.program_id, p.sessions_per_week, p.created_at
            order by p.created_at desc
            limit 1
            """,
            user_id,
        )
        spw = prog["sessions_per_week"] if prog else 0
        sets_per_session = int(prog["sets_per_session"]) if prog else 0
        sessions_prescribed = round(spw * weeks)
        sets_prescribed = sets_per_session * sessions_prescribed

        counts = await self._pool.fetchrow(
            """
            select
              (select count(*) from sessions s
                 where s.user_id = $1::uuid and s.completed_at is not null
                   and s.completed_at >= now() - make_interval(days => $2::int)) as sessions_done,
              (select count(*) from set_logs sl
                 where sl.user_id = $1::uuid
                   and sl.logged_at >= now() - make_interval(days => $2::int)) as sets_done
            """,
            user_id,
            window_days,
        )
        return AdherenceSummary(
            window_days=window_days,
            sessions_prescribed=sessions_prescribed,
            sessions_completed=counts["sessions_done"],
            sets_prescribed=sets_prescribed,
            sets_completed=counts["sets_done"],
        )

    # --- nutrition -----------------------------------------------------------
    async def get_nutrition_summary(self, user_id: str, window_days: int) -> NutritionSummary:
        row = await self._pool.fetchrow(
            """
            select count(distinct logged_on) as days,
                   avg(kcal)                 as avg_kcal,
                   avg(protein_g)            as avg_protein
            from nutrition_logs
            where user_id = $1::uuid
              and logged_on >= (now() - make_interval(days => $2::int))::date
            """,
            user_id,
            window_days,
        )
        current = await self.get_current_targets(user_id)
        return NutritionSummary(
            window_days=window_days,
            days_logged=row["days"] or 0,
            avg_kcal=float(row["avg_kcal"]) if row["avg_kcal"] is not None else None,
            target_kcal=current.daily_kcal if current else None,
            avg_protein_g=float(row["avg_protein"]) if row["avg_protein"] is not None else None,
        )

    # --- targets -------------------------------------------------------------
    async def get_current_targets(self, user_id: str) -> Optional[Targets]:
        row = await self._pool.fetchrow(
            "select * from targets where user_id = $1::uuid order by created_at desc limit 1",
            user_id,
        )
        if row is None:
            return None
        return Targets(
            target_id=str(row["target_id"]),
            daily_kcal=row["daily_kcal"],
            protein_g=row["protein_g"],
            source=row["source"],
            rationale=row["rationale"],
            created_at=row["created_at"],
        )

    async def insert_target(self, user_id: str, targets: Targets) -> Targets:
        async with self._pool.acquire() as con:
            async with con.transaction():
                row = await con.fetchrow(
                    """
                    insert into targets (user_id, daily_kcal, protein_g, source, rationale)
                    values ($1::uuid, $2, $3, $4, $5)
                    returning target_id, created_at
                    """,
                    user_id,
                    targets.daily_kcal,
                    targets.protein_g,
                    targets.source,
                    targets.rationale,
                )
                await con.execute(
                    "update profiles set current_target_id = $2 where user_id = $1::uuid",
                    user_id,
                    row["target_id"],
                )
        return targets.model_copy(
            update={"target_id": str(row["target_id"]), "created_at": row["created_at"]}
        )

    # --- program reads + edits ----------------------------------------------
    async def get_program_exercises(self, user_id: str) -> list[ProgramExerciseRef]:
        rows = await self._pool.fetch(
            """
            select pe.program_exercise_id, pe.exercise_id
            from program_exercises pe
            join programs p on p.program_id = pe.program_id
            where p.user_id = $1::uuid and p.is_active
            order by pe.position
            """,
            user_id,
        )
        return [
            ProgramExerciseRef(
                program_exercise_id=str(r["program_exercise_id"]),
                exercise_id=r["exercise_id"],
                name=self._catalog.name_of(r["exercise_id"]),
                equipment=self._catalog.equipment_of(r["exercise_id"]),
            )
            for r in rows
        ]

    async def apply_program_change(self, user_id: str, change: ProposedProgramChange) -> None:
        async with self._pool.acquire() as con:
            async with con.transaction():
                for e in change.edits:
                    # The join to programs enforces that the edit belongs to this user.
                    status = await con.execute(
                        """
                        update program_exercises pe
                        set exercise_id = coalesce($3, pe.exercise_id),
                            sets        = coalesce($4, pe.sets),
                            reps        = coalesce($5, pe.reps),
                            load_kg     = coalesce($6, pe.load_kg)
                        from programs p
                        where pe.program_exercise_id = $2::uuid
                          and pe.program_id = p.program_id
                          and p.user_id = $1::uuid
                        """,
                        user_id,
                        e.program_exercise_id,
                        e.swap_to_exercise_id,
                        e.sets,
                        e.reps,
                        e.load_kg,
                    )
                    # asyncpg returns a command tag like 'UPDATE 1'. Zero rows means the
                    # slot doesn't exist OR isn't owned by this user — refuse loudly either
                    # way; a silent no-op would hide a scoping violation. The transaction
                    # rolls back all edits in the batch.
                    if status.rsplit(" ", 1)[-1] != "1":
                        raise PermissionError(
                            f"program_exercise {e.program_exercise_id!r} not found for "
                            f"user {user_id!r} — refusing edit (wrong id or not owned)"
                        )

    # --- catalog variant lookup (delegates to the seed-loaded index) ---------
    async def find_equipment_variant(
        self, exercise_id: str, available_equipment: set[str]
    ) -> Optional[VariantMatch]:
        return self._catalog.find_equipment_variant(exercise_id, available_equipment)

    # --- reviews -------------------------------------------------------------
    async def record_review(
        self, user_id: str, status: str, summary: str, changes: dict
    ) -> str:
        row = await self._pool.fetchrow(
            """
            insert into coach_reviews (user_id, status, summary, changes)
            values ($1::uuid, $2, $3, $4::jsonb)
            returning review_id
            """,
            user_id,
            status,
            summary,
            json.dumps(changes),
        )
        return str(row["review_id"])

    # --- logging API (PWA Today screen; idempotent for offline replay) --------
    async def get_program_slots(self, user_id: str) -> list[dict]:
        """Program slots with prescriptions + catalog media, for the session UI."""
        rows = await self._pool.fetch(
            """
            select pe.program_exercise_id, pe.exercise_id, pe.position,
                   pe.sets, pe.reps, pe.load_kg
            from program_exercises pe
            join programs p on p.program_id = pe.program_id
            where p.user_id = $1::uuid and p.is_active
            order by pe.position
            """,
            user_id,
        )
        out = []
        for r in rows:
            detail = self._catalog.detail_of(r["exercise_id"])
            out.append({
                "program_exercise_id": str(r["program_exercise_id"]),
                "position": r["position"],
                "sets": r["sets"],
                "reps": r["reps"],
                "load_kg": float(r["load_kg"]) if r["load_kg"] is not None else None,
                **detail,
            })
        return out

    async def start_session(self, user_id: str, session_id: str, started_at) -> None:
        """Idempotent: client generates the session UUID so offline replays are safe."""
        await self._pool.execute(
            """
            insert into sessions (session_id, user_id, program_id, started_at)
            select $2::uuid, $1::uuid, p.program_id, $3
            from programs p where p.user_id = $1::uuid and p.is_active
            limit 1
            on conflict (session_id) do nothing
            """,
            user_id, session_id, started_at,
        )

    async def insert_set_logs(self, user_id: str, session_id: str, sets: list[dict]) -> int:
        """Idempotent batch insert: client-generated set ids; replays insert nothing new.
        The session-ownership check stops a forged session_id from attaching sets to
        another user's session."""
        owned = await self._pool.fetchval(
            "select 1 from sessions where session_id = $1::uuid and user_id = $2::uuid",
            session_id, user_id,
        )
        if not owned:
            raise PermissionError(f"session {session_id!r} not found for user {user_id!r}")
        inserted = 0
        async with self._pool.acquire() as con:
            async with con.transaction():
                for s in sets:
                    status = await con.execute(
                        """
                        insert into set_logs (id, session_id, user_id, exercise_id,
                                              reps, weight_kg, rpe, logged_at)
                        values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
                        on conflict (id) do nothing
                        """,
                        s["id"], session_id, user_id, s["exercise_id"],
                        s.get("reps"), s.get("weight_kg"), s.get("rpe"), s["logged_at"],
                    )
                    inserted += int(status.rsplit(" ", 1)[-1])
        return inserted

    async def complete_session(self, user_id: str, session_id: str, completed_at) -> None:
        await self._pool.execute(
            """
            update sessions set completed_at = coalesce(completed_at, $3)
            where session_id = $1::uuid and user_id = $2::uuid
            """,
            session_id, user_id, completed_at,
        )
