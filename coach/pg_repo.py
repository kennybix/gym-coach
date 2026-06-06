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


def _json_safe(v):
    """Coerce a DB value to something JSON-serializable for the data export."""
    import datetime
    import decimal
    import uuid

    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, str) and v[:1] in ("{", "["):  # jsonb came back as text
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def _rows_json(records) -> list[dict]:
    return [{k: _json_safe(val) for k, val in dict(r).items()} for r in records]


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
                coalesce(max(recorded_at)::date - min(recorded_at)::date, 0) as span_days,
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
        n = row["n"] or 0
        span_days = int(row["span_days"] or 0)
        # A trustworthy weekly rate needs enough readings spread over enough time;
        # below this the UI/coach must not state a kg/wk figure.
        sufficient = n >= 4 and span_days >= 14
        return WeightTrend(
            window_days=window_days,
            start_kg=float(row["start_kg"]) if row["start_kg"] is not None else None,
            latest_kg=float(row["latest_kg"]) if row["latest_kg"] is not None else None,
            smoothed_slope_kg_per_week=float(slope) * 7 if slope is not None else None,
            n_points=n,
            span_days=span_days,
            sufficient=sufficient,
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
        # Last working set per exercise (latest session, heaviest non-warmup) → deterministic
        # next-load suggestion. System-computed; the coach only explains it, never overrides.
        ex_ids = [r["exercise_id"] for r in rows]
        last: dict = {}
        if ex_ids:
            lw = await self._pool.fetch(
                """
                select distinct on (sl.exercise_id) sl.exercise_id, sl.weight_kg, sl.reps, sl.rpe
                from set_logs sl join sessions s on s.session_id = sl.session_id
                where sl.user_id = $1::uuid and sl.exercise_id = any($2::text[])
                  and sl.weight_kg is not null and sl.reps is not null
                  and coalesce(sl.set_type, 'normal') <> 'warmup'
                order by sl.exercise_id, s.started_at desc, sl.weight_kg desc
                """,
                user_id, ex_ids,
            )
            last = {r["exercise_id"]: r for r in lw}
        out = []
        for r in rows:
            detail = self._catalog.detail_of(r["exercise_id"])
            sug_kg, sug_reason = self._suggest_load(last.get(r["exercise_id"]), r["reps"])
            out.append({
                "program_exercise_id": str(r["program_exercise_id"]),
                "position": r["position"],
                "sets": r["sets"],
                "reps": r["reps"],
                "load_kg": float(r["load_kg"]) if r["load_kg"] is not None else None,
                "suggested_kg": sug_kg,
                "suggested_reason": sug_reason,
                **detail,
            })
        return out

    @staticmethod
    def _suggest_load(last, target_reps):
        """Deterministic progressive-overload rule from the last working set. Returns
        (suggested_kg, reason) or (None, None) when there's no history to base it on."""
        if not last or not target_reps:
            return None, None
        w = float(last["weight_kg"])
        reps = last["reps"]
        rpe = float(last["rpe"]) if last["rpe"] is not None else None
        if reps >= target_reps and (rpe is None or rpe <= 8):
            return round((w + 2.5) * 2) / 2, (
                f"+2.5 kg — hit {reps} reps last time" + (f" at RPE {rpe:g}" if rpe is not None else "")
            )
        if reps < target_reps:
            return w, f"repeat {w:g} kg — missed target last time ({reps}/{target_reps})"
        return w, f"repeat {w:g} kg — tough last time, consolidate"

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
                                              reps, weight_kg, rpe, logged_at, duration_s, distance_m, set_type)
                        values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)
                        on conflict (id) do nothing
                        """,
                        s["id"], session_id, user_id, s["exercise_id"],
                        s.get("reps"), s.get("weight_kg"), s.get("rpe"), s["logged_at"],
                        s.get("duration_s"), s.get("distance_m"), s.get("set_type"),
                    )
                    inserted += int(status.rsplit(" ", 1)[-1])
        return inserted

    async def delete_set_log(self, user_id: str, session_id: str, set_id: str) -> int:
        """Delete one logged set, scoped to the owner's session. Idempotent: returns the
        number of rows removed (0 if already gone), so offline-queue replays are safe."""
        status = await self._pool.execute(
            """delete from set_logs
               where id = $1::uuid and user_id = $2::uuid and session_id = $3::uuid""",
            set_id, user_id, session_id,
        )
        return int(status.rsplit(" ", 1)[-1])

    async def update_set_log(self, user_id: str, session_id: str, set_id: str,
                             reps, weight_kg, duration_s=None, distance_m=None,
                             rpe=None, set_type=None) -> int:
        """Edit a logged set in place (reps/weight for strength, duration/distance for cardio),
        scoped to the owner's session. rpe/set_type only change when provided (COALESCE), so a
        plain reps/weight edit doesn't wipe a tag. Idempotent; returns rows affected (0 if gone)."""
        status = await self._pool.execute(
            """update set_logs set reps = $4, weight_kg = $5, duration_s = $6, distance_m = $7,
                                   rpe = coalesce($8, rpe), set_type = coalesce($9, set_type)
               where id = $1::uuid and user_id = $2::uuid and session_id = $3::uuid""",
            set_id, user_id, session_id, reps, weight_kg, duration_s, distance_m, rpe, set_type,
        )
        return int(status.rsplit(" ", 1)[-1])

    async def complete_session(self, user_id: str, session_id: str, completed_at) -> None:
        await self._pool.execute(
            """
            update sessions set completed_at = coalesce(completed_at, $3)
            where session_id = $1::uuid and user_id = $2::uuid
            """,
            session_id, user_id, completed_at,
        )

    async def get_session_history(self, user_id: str, limit: int = 30) -> list[dict]:
        """Past sessions (most recent first) with their logged sets + exercise names,
        for the history screen. Empty sessions are omitted."""
        sessions = await self._pool.fetch(
            """select session_id, started_at, completed_at from sessions
               where user_id = $1::uuid order by started_at desc limit $2""",
            user_id, limit,
        )
        if not sessions:
            return []
        ids = [s["session_id"] for s in sessions]
        rows = await self._pool.fetch(
            """select id, session_id, exercise_id, reps, weight_kg, rpe, set_type,
                      duration_s, distance_m, logged_at
               from set_logs where user_id = $1::uuid and session_id = any($2::uuid[])
               order by logged_at""",
            user_id, ids,
        )
        by_session: dict = {}
        for r in rows:
            by_session.setdefault(str(r["session_id"]), []).append({
                "id": str(r["id"]),
                "exercise_id": r["exercise_id"],
                "name": self._catalog.name_of(r["exercise_id"]),
                "reps": r["reps"],
                "weight_kg": float(r["weight_kg"]) if r["weight_kg"] is not None else None,
                "rpe": float(r["rpe"]) if r["rpe"] is not None else None,
                "set_type": r["set_type"],
                "duration_s": r["duration_s"],
                "distance_m": r["distance_m"],
                "logged_at": r["logged_at"].isoformat(),
            })
        out = []
        for s in sessions:
            sid = str(s["session_id"])
            sets = by_session.get(sid, [])
            if not sets:
                continue
            out.append({
                "session_id": sid,
                "started_at": s["started_at"].isoformat(),
                "completed_at": s["completed_at"].isoformat() if s["completed_at"] else None,
                "sets": sets,
            })
        return out

    async def get_exercise_stats(self, user_id: str, exercise_id: str) -> dict:
        """Per-exercise progression: lifetime bests + a per-session series (top estimated-1RM,
        top weight, volume). e1RM uses Epley: weight*(1+reps/30). Strength sets only."""
        E1RM = "weight_kg * (1 + reps / 30.0)"
        agg = await self._pool.fetchrow(
            f"""select max({E1RM}) as best_e1rm, max(weight_kg) as heaviest_kg,
                       count(*) as total_sets, coalesce(sum(weight_kg * reps), 0) as total_volume
                from set_logs
                where user_id = $1::uuid and exercise_id = $2
                  and weight_kg is not null and reps is not null""",
            user_id, exercise_id,
        )
        best = await self._pool.fetchrow(
            f"""select weight_kg, reps, {E1RM} as e1rm from set_logs
                where user_id = $1::uuid and exercise_id = $2
                  and weight_kg is not null and reps is not null
                order by e1rm desc limit 1""",
            user_id, exercise_id,
        )
        rows = await self._pool.fetch(
            f"""select coalesce(s.completed_at, s.started_at)::date as date,
                       max({E1RM}) as e1rm, max(sl.weight_kg) as top_weight,
                       sum(sl.weight_kg * sl.reps) as volume
                from set_logs sl join sessions s on s.session_id = sl.session_id
                where sl.user_id = $1::uuid and sl.exercise_id = $2
                  and sl.weight_kg is not null and sl.reps is not null
                group by date order by date""",
            user_id, exercise_id,
        )
        return {
            "exercise_id": exercise_id,
            "name": self._catalog.name_of(exercise_id),
            "best_e1rm": round(float(agg["best_e1rm"]), 1) if agg["best_e1rm"] is not None else None,
            "heaviest_kg": float(agg["heaviest_kg"]) if agg["heaviest_kg"] is not None else None,
            "total_sets": agg["total_sets"] or 0,
            "total_volume": round(float(agg["total_volume"] or 0)),
            "best_set": (
                {"weight_kg": float(best["weight_kg"]), "reps": best["reps"],
                 "e1rm": round(float(best["e1rm"]), 1)} if best else None
            ),
            "series": [
                {"date": r["date"].isoformat(), "e1rm": round(float(r["e1rm"]), 1),
                 "top_weight": float(r["top_weight"]), "volume": round(float(r["volume"] or 0))}
                for r in rows
            ],
        }

    # --- trends (weight series for charting + idempotent weight logging) ------
    async def get_weight_series(self, user_id: str, window_days: int) -> list[dict]:
        """Daily-averaged weight points for the trend chart (smooths intra-day noise)."""
        rows = await self._pool.fetch(
            """
            select (recorded_at at time zone 'utc')::date as d, avg(weight_kg) as w
            from body_metrics
            where user_id = $1::uuid and weight_kg is not null
              and recorded_at >= now() - make_interval(days => $2::int)
            group by 1 order by d
            """,
            user_id, window_days,
        )
        return [{"date": r["d"].isoformat(), "weight_kg": float(r["w"])} for r in rows]

    async def insert_body_metric(self, user_id: str, metric_id: str, recorded_at, weight_kg) -> None:
        """Idempotent (client-generated id) so offline weight entries replay safely."""
        await self._pool.execute(
            """
            insert into body_metrics (id, user_id, recorded_at, weight_kg)
            values ($1::uuid, $2::uuid, $3, $4)
            on conflict (id) do nothing
            """,
            metric_id, user_id, recorded_at, weight_kg,
        )

    async def set_weight_for_date(self, user_id: str, day, weight_kg, recorded_at, metric_id: str) -> None:
        """Set a single canonical weight for a calendar day (UTC): replace any existing
        weigh-ins on that date with one value. Effect-idempotent, so queue replays converge."""
        async with self._pool.acquire() as con:
            async with con.transaction():
                await con.execute(
                    "delete from body_metrics where user_id = $1::uuid "
                    "and (recorded_at at time zone 'utc')::date = $2",
                    user_id, day,
                )
                await con.execute(
                    "insert into body_metrics (id, user_id, recorded_at, weight_kg) "
                    "values ($1::uuid, $2::uuid, $3, $4)",
                    metric_id, user_id, recorded_at, weight_kg,
                )

    async def delete_weight_for_date(self, user_id: str, day) -> int:
        """Remove all weigh-ins on a calendar day (UTC). Idempotent (0 if none)."""
        status = await self._pool.execute(
            "delete from body_metrics where user_id = $1::uuid "
            "and (recorded_at at time zone 'utc')::date = $2",
            user_id, day,
        )
        return int(status.rsplit(" ", 1)[-1])

    # --- vitals (timestamped BP / heart-rate log; many per day) --------------
    async def insert_vital(self, user_id: str, vid: str, recorded_at, systolic,
                           diastolic, heart_rate, tag, note) -> None:
        """Idempotent (client-generated id) so offline vitals entries replay safely."""
        await self._pool.execute(
            """insert into vitals (id, user_id, recorded_at, systolic, diastolic, heart_rate, tag, note)
               values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
               on conflict (id) do nothing""",
            vid, user_id, recorded_at, systolic, diastolic, heart_rate, tag, note,
        )

    async def update_vital(self, user_id: str, vid: str, systolic, diastolic,
                           heart_rate, tag, note) -> int:
        status = await self._pool.execute(
            """update vitals set systolic = $3, diastolic = $4, heart_rate = $5, tag = $6, note = $7
               where id = $1::uuid and user_id = $2::uuid""",
            vid, user_id, systolic, diastolic, heart_rate, tag, note,
        )
        return int(status.rsplit(" ", 1)[-1])

    async def delete_vital(self, user_id: str, vid: str) -> int:
        status = await self._pool.execute(
            "delete from vitals where id = $1::uuid and user_id = $2::uuid", vid, user_id
        )
        return int(status.rsplit(" ", 1)[-1])

    async def get_vitals(self, user_id: str, limit: int = 50) -> list[dict]:
        rows = await self._pool.fetch(
            """select id, recorded_at, systolic, diastolic, heart_rate, tag, note
               from vitals where user_id = $1::uuid order by recorded_at desc limit $2""",
            user_id, limit,
        )
        return [{
            "id": str(r["id"]),
            "recorded_at": r["recorded_at"].isoformat(),
            "systolic": r["systolic"],
            "diastolic": r["diastolic"],
            "heart_rate": r["heart_rate"],
            "tag": r["tag"],
            "note": r["note"],
        } for r in rows]

    async def get_vitals_summary(self, user_id: str, window_days: int = 30) -> dict:
        """Compact vitals summary for the coach: latest + averages + trend, over a window."""
        rows = await self._pool.fetch(
            """select recorded_at, systolic, diastolic, heart_rate, tag from vitals
               where user_id = $1::uuid
                 and recorded_at >= now() - make_interval(days => $2::int)
               order by recorded_at""",
            user_id, window_days,
        )
        bp = [(r["systolic"], r["diastolic"], r["recorded_at"]) for r in rows if r["systolic"] is not None]
        hr = [(r["heart_rate"], r["recorded_at"], (r["tag"] or "")) for r in rows if r["heart_rate"] is not None]
        rest_hr = [h[0] for h in hr if h[2].lower() in ("resting", "morning")]

        def avg(xs):
            return round(sum(xs) / len(xs), 1) if xs else None

        out = {"window_days": window_days, "n_readings": len(rows)}
        if bp:
            out["blood_pressure"] = {
                "latest": f"{bp[-1][0]}/{bp[-1][1]}",
                "avg_systolic": avg([b[0] for b in bp]),
                "avg_diastolic": avg([b[1] for b in bp]),
                "n": len(bp),
            }
        if hr:
            out["heart_rate"] = {
                "latest_bpm": hr[-1][0],
                "avg_bpm": avg([h[0] for h in hr]),
                "resting_avg_bpm": avg(rest_hr) if rest_hr else None,
                "min_bpm": min(h[0] for h in hr),
                "max_bpm": max(h[0] for h in hr),
                "n": len(hr),
            }
        return out

    async def get_latest_review(self, user_id: str) -> Optional[dict]:
        row = await self._pool.fetchrow(
            """
            select review_id::text as review_id, status, summary, changes, created_at
            from coach_reviews where user_id = $1::uuid
            order by created_at desc limit 1
            """,
            user_id,
        )
        if row is None:
            return None
        return {
            "review_id": row["review_id"], "status": row["status"],
            "summary": row["summary"], "changes": _as_list(row["changes"]) if False else row["changes"],
            "created_at": row["created_at"].isoformat(),
        }

    # --- nutrition (day-level; logging-consistency framing) ------------------
    async def upsert_nutrition_day(self, user_id: str, logged_on, kcal, protein_g) -> None:
        """One row per day (natural key user_id+logged_on) => offline replay is idempotent."""
        await self._pool.execute(
            """
            insert into nutrition_logs (user_id, logged_on, kcal, protein_g)
            values ($1::uuid, $2, $3, $4)
            on conflict (user_id, logged_on)
            do update set kcal = excluded.kcal, protein_g = excluded.protein_g
            """,
            user_id, logged_on, kcal, protein_g,
        )

    # --- itemized food entries (food-database logging) ----------------------
    async def insert_food_entry(self, user_id: str, fid: str, logged_on, name, brand,
                                grams, kcal, protein_g) -> None:
        """Idempotent (client-generated id) so offline food logging replays safely."""
        await self._pool.execute(
            """insert into food_entries (id, user_id, logged_on, name, brand, grams, kcal, protein_g)
               values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
               on conflict (id) do nothing""",
            fid, user_id, logged_on, name, brand, grams, kcal, protein_g,
        )

    async def get_food_entries(self, user_id: str, logged_on) -> list[dict]:
        rows = await self._pool.fetch(
            """select id, name, brand, grams, kcal, protein_g from food_entries
               where user_id = $1::uuid and logged_on = $2 order by created_at""",
            user_id, logged_on,
        )
        return [{
            "id": str(r["id"]), "name": r["name"], "brand": r["brand"],
            "grams": float(r["grams"]) if r["grams"] is not None else None,
            "kcal": r["kcal"],
            "protein_g": float(r["protein_g"]) if r["protein_g"] is not None else None,
        } for r in rows]

    async def delete_food_entry(self, user_id: str, fid: str) -> int:
        status = await self._pool.execute(
            "delete from food_entries where id = $1::uuid and user_id = $2::uuid", fid, user_id
        )
        return int(status.rsplit(" ", 1)[-1])

    async def get_recent_foods(self, user_id: str, limit: int = 12) -> list[dict]:
        """Distinct recently-logged foods (most recent portion), for one-tap re-logging."""
        rows = await self._pool.fetch(
            """select distinct on (lower(name), coalesce(lower(brand), ''))
                      name, brand, grams, kcal, protein_g, created_at
               from food_entries where user_id = $1::uuid
               order by lower(name), coalesce(lower(brand), ''), created_at desc""",
            user_id,
        )
        items = [{
            "name": r["name"], "brand": r["brand"],
            "grams": float(r["grams"]) if r["grams"] is not None else None,
            "kcal": r["kcal"],
            "protein_g": float(r["protein_g"]) if r["protein_g"] is not None else None,
            "_ts": r["created_at"],
        } for r in rows]
        items.sort(key=lambda x: x["_ts"], reverse=True)
        for it in items:
            del it["_ts"]
        return items[:limit]

    async def recompute_nutrition_day(self, user_id: str, logged_on) -> dict:
        """Set the day's nutrition_logs total to the sum of its food entries, so the summary,
        coach, and trends stay consistent. Food entries own the day's total when present."""
        row = await self._pool.fetchrow(
            """select coalesce(sum(kcal), 0)::int as kcal,
                      coalesce(sum(protein_g), 0)::numeric as protein_g
               from food_entries where user_id = $1::uuid and logged_on = $2""",
            user_id, logged_on,
        )
        kcal, protein = row["kcal"], float(row["protein_g"])
        await self.upsert_nutrition_day(user_id, logged_on, kcal, protein)
        return {"kcal": kcal, "protein_g": protein}

    async def get_nutrition_series(self, user_id: str, window_days: int) -> list[dict]:
        rows = await self._pool.fetch(
            """
            select logged_on::text as date, kcal, protein_g
            from nutrition_logs
            where user_id = $1::uuid and logged_on >= current_date - ($2::int - 1)
            order by logged_on
            """,
            user_id, window_days,
        )
        return [
            {"date": r["date"], "kcal": r["kcal"],
             "protein_g": float(r["protein_g"]) if r["protein_g"] is not None else None}
            for r in rows
        ]

    # --- onboarding ------------------------------------------------------------
    async def create_profile(self, user_id: str, *, sex: str, birth_year: int,
                             height_cm: float, activity_level: str, goal_weight_kg: float,
                             weekly_rate_kg: float, medical_flags: list[str]) -> None:
        await self._pool.execute(
            """
            insert into profiles (user_id, sex, birth_year, height_cm, activity_level,
                                  goal_weight_kg, weekly_rate_kg, medical_flags)
            values ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb)
            on conflict (user_id) do update set
                sex = excluded.sex, birth_year = excluded.birth_year,
                height_cm = excluded.height_cm, activity_level = excluded.activity_level,
                goal_weight_kg = excluded.goal_weight_kg,
                weekly_rate_kg = excluded.weekly_rate_kg,
                medical_flags = excluded.medical_flags
            """,
            user_id, sex, birth_year, height_cm, activity_level,
            goal_weight_kg, weekly_rate_kg, json.dumps(medical_flags),
        )

    async def create_program(self, user_id: str, name: str, sessions_per_week: int,
                             exercises: list[dict]) -> str:
        """Replaces the active program (old ones are kept inactive for history)."""
        async with self._pool.acquire() as con:
            async with con.transaction():
                await con.execute(
                    "update programs set is_active = false where user_id = $1::uuid",
                    user_id,
                )
                pid = await con.fetchval(
                    """insert into programs (user_id, name, sessions_per_week, is_active)
                       values ($1::uuid, $2, $3, true) returning program_id""",
                    user_id, name, sessions_per_week,
                )
                for i, e in enumerate(exercises):
                    await con.execute(
                        """insert into program_exercises (program_id, exercise_id, position, sets, reps)
                           values ($1, $2, $3, $4, $5)""",
                        pid, e["exercise_id"], i, e["sets"], e["reps"],
                    )
        return str(pid)

    async def get_active_program_meta(self, user_id: str) -> Optional[dict]:
        """Name + cadence of the active program, so an editor can preserve them on save."""
        row = await self._pool.fetchrow(
            "select name, sessions_per_week from programs where user_id = $1::uuid and is_active limit 1",
            user_id,
        )
        return {"name": row["name"], "sessions_per_week": row["sessions_per_week"]} if row else None

    async def export_all(self, user_id: str) -> dict:
        """A complete, JSON-serializable dump of the user's own data — for backup/export."""
        async def q(sql: str) -> list[dict]:
            return _rows_json(await self._pool.fetch(sql, user_id))

        profiles = await q("select * from profiles where user_id = $1::uuid")
        programs = await q("select * from programs where user_id = $1::uuid order by created_at")
        program_exercises = await q(
            """select pe.* from program_exercises pe join programs p on p.program_id = pe.program_id
               where p.user_id = $1::uuid order by pe.program_id, pe.position"""
        )
        return {
            "profile": profiles[0] if profiles else None,
            "targets": await q("select * from targets where user_id = $1::uuid order by created_at"),
            "weight": await q("select * from body_metrics where user_id = $1::uuid order by recorded_at"),
            "nutrition": await q("select * from nutrition_logs where user_id = $1::uuid order by logged_on"),
            "vitals": await q("select * from vitals where user_id = $1::uuid order by recorded_at"),
            "workouts": await self.get_session_history(user_id, 1000),
            "programs": programs,
            "program_exercises": program_exercises,
            "reviews": await q("select * from coach_reviews where user_id = $1::uuid order by created_at"),
        }

    def search_catalog(self, q=None, equipment=None, limit: int = 30) -> list[dict]:
        return self._catalog.search(q=q, equipment=equipment, limit=limit)
