"""REST API for the PWA (Today screen + offline sync).

Design notes:
  * All ids for sessions/sets are CLIENT-generated UUIDs and every write is
    idempotent (insert ... on conflict do nothing), so the offline queue can
    replay a batch any number of times safely.
  * user_id comes only from the verified JWT (auth.get_current_user_id).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import safety as safety_mod
from .auth import get_current_user_id
from .models import Targets

router = APIRouter(prefix="/api")

# set by service.py at startup
_repo = None


def bind_repo(repo) -> None:
    global _repo
    _repo = repo


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/program/today")
async def program_today(user_id: str = Depends(get_current_user_id)):
    slots = await _repo.get_program_slots(user_id)
    return {"date": _now().date().isoformat(), "slots": slots}


class SessionStartIn(BaseModel):
    session_id: str  # client-generated uuid
    started_at: Optional[datetime] = None


@router.post("/sessions/start")
async def session_start(body: SessionStartIn, user_id: str = Depends(get_current_user_id)):
    await _repo.start_session(user_id, body.session_id, body.started_at or _now())
    return {"status": "ok", "session_id": body.session_id}


class SetIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    exercise_id: str
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    rpe: Optional[float] = None
    logged_at: datetime


class SetSyncIn(BaseModel):
    session_id: str
    sets: list[SetIn] = Field(default_factory=list)


@router.post("/sets/sync")
async def sets_sync(body: SetSyncIn, user_id: str = Depends(get_current_user_id)):
    inserted = await _repo.insert_set_logs(
        user_id, body.session_id, [s.model_dump() for s in body.sets]
    )
    return {"status": "ok", "received": len(body.sets), "inserted": inserted}


class SessionCompleteIn(BaseModel):
    session_id: str
    completed_at: Optional[datetime] = None


@router.post("/sessions/complete")
async def session_complete(body: SessionCompleteIn, user_id: str = Depends(get_current_user_id)):
    await _repo.complete_session(user_id, body.session_id, body.completed_at or _now())
    return {"status": "ok"}


@router.get("/trends")
async def trends(window: int = 30, user_id: str = Depends(get_current_user_id)):
    profile = await _repo.get_profile(user_id)
    trend = await _repo.get_weight_trend(user_id, window)
    adherence = await _repo.get_adherence(user_id, window)
    series = await _repo.get_weight_series(user_id, window)
    return {
        "window_days": window,
        "goal_weight_kg": profile.goal_weight_kg,
        "weight_series": series,
        "trend": trend.model_dump(),
        "adherence": adherence.model_dump(),
    }


class WeightIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    weight_kg: float
    recorded_at: datetime


@router.post("/metrics/weight")
async def log_weight(body: WeightIn, user_id: str = Depends(get_current_user_id)):
    await _repo.insert_body_metric(user_id, body.id, body.recorded_at, body.weight_kg)
    return {"status": "ok"}


@router.get("/nutrition")
async def nutrition(window: int = 14, user_id: str = Depends(get_current_user_id)):
    summary = await _repo.get_nutrition_summary(user_id, window)
    series = await _repo.get_nutrition_series(user_id, window)
    return {**summary.model_dump(), "series": series}


class NutritionIn(BaseModel):
    logged_on: Optional[str] = None  # ISO date; defaults to today
    kcal: Optional[int] = None
    protein_g: Optional[float] = None


@router.post("/nutrition")
async def log_nutrition(body: NutritionIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.logged_on) if body.logged_on else _now().date()
    await _repo.upsert_nutrition_day(user_id, day, body.kcal, body.protein_g)
    return {"status": "ok", "logged_on": day.isoformat()}


# ----------------------------- onboarding -----------------------------------

@router.get("/onboarding/status")
async def onboarding_status(user_id: str = Depends(get_current_user_id)):
    try:
        await _repo.get_profile(user_id)
        return {"onboarded": True}
    except LookupError:
        return {"onboarded": False}


class OnboardIn(BaseModel):
    sex: str
    birth_year: int
    height_cm: float
    activity_level: str
    current_weight_kg: float
    goal_weight_kg: float
    weekly_rate_kg: float = Field(ge=0)
    injury_active: bool = False
    eating_disorder_history: bool = False


@router.post("/onboarding")
async def onboard(body: OnboardIn, user_id: str = Depends(get_current_user_id)):
    import uuid as _uuid

    flags: list[str] = []
    if body.injury_active:
        flags.append("injury_active")
    if body.eating_disorder_history:
        flags.append("eating_disorder_history")

    # cap the goal rate server-side (client also caps; never trust the client)
    rate = min(body.weekly_rate_kg, safety_mod.MAX_SAFE_WEEKLY_RATE_KG)
    rate_capped = rate < body.weekly_rate_kg

    await _repo.create_profile(
        user_id, sex=body.sex, birth_year=body.birth_year, height_cm=body.height_cm,
        activity_level=body.activity_level, goal_weight_kg=body.goal_weight_kg,
        weekly_rate_kg=rate, medical_flags=flags,
    )
    await _repo.insert_body_metric(user_id, str(_uuid.uuid4()), _now(), body.current_weight_kg)

    profile = await _repo.get_profile(user_id)
    est = safety_mod.estimate_initial_target(profile, body.current_weight_kg)
    if est is None:
        return {"status": "ok", "targets_disabled": True, "rate_capped": rate_capped,
                "note": ("Automated calorie targets are off. Your coach will support training; "
                         "for nutrition guidance, specialized professionals are the right partner.")}

    daily_kcal, protein_g = est
    target = await _repo.insert_target(user_id, Targets(
        daily_kcal=daily_kcal, protein_g=protein_g, source="onboarding",
        rationale="Onboarding starting point — conservative estimate; your coach adjusts it from your real data.",
    ))
    return {"status": "ok", "targets_disabled": False, "rate_capped": rate_capped,
            "target": target.model_dump(mode="json")}


@router.get("/catalog/exercises")
async def catalog_exercises(q: str | None = None, equipment: str | None = None,
                            user_id: str = Depends(get_current_user_id)):
    return {"exercises": _repo.search_catalog(q=q, equipment=equipment, limit=30)}


class ProgramExerciseIn(BaseModel):
    exercise_id: str
    sets: int = Field(ge=1, le=10)
    reps: int = Field(ge=1, le=100)


class ProgramIn(BaseModel):
    name: str = "Main"
    sessions_per_week: int = Field(ge=1, le=7)
    exercises: list[ProgramExerciseIn] = Field(min_length=1)


@router.post("/program")
async def create_program(body: ProgramIn, user_id: str = Depends(get_current_user_id)):
    pid = await _repo.create_program(
        user_id, body.name, body.sessions_per_week,
        [e.model_dump() for e in body.exercises],
    )
    return {"status": "ok", "program_id": pid}
