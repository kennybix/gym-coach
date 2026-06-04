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

from .auth import get_current_user_id

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
