"""FastAPI wiring (hardened).

`user_id` is no longer accepted from request bodies — it is derived from a verified
JWT via `get_current_user_id`. The chat graph uses a Postgres checkpointer for
persistent memory and resumable confirmation interrupts.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from pydantic import BaseModel

from fastapi.middleware.cors import CORSMiddleware

from . import api as rest_api
from .auth import get_current_user_id
from . import energy, media
from .graph import build_coach_graph, summarize_evidence
from .parse import parse_workout
from .vision import parse_food_photo
from .insight import generate_insight
from .review import build_review_graph
from .pg_repo import PostgresCoachRepo

DB_URI = os.environ["COACH_DB_URI"]
MODEL_ID = os.environ.get("COACH_MODEL", "google_genai:gemini-3.5-flash")
SEED_DIR = os.environ.get("COACH_SEED_DIR", "./seed")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncPostgresSaver.from_conn_string(DB_URI) as saver:
        await saver.setup()
        repo = await PostgresCoachRepo.create(DB_URI, SEED_DIR)
        rest_api.bind_repo(repo)
        _state["repo"] = repo
        try:
            _state["chat"] = build_coach_graph(repo, checkpointer=saver, model_id=MODEL_ID)
            _state["review"] = build_review_graph(repo, model_id=MODEL_ID)
            _state["insight_model"] = init_chat_model(MODEL_ID, temperature=0.3)
        except Exception as exc:  # missing provider pkg/key must not kill the logging API
            logging.warning("coach graphs unavailable (LLM not configured): %s", exc)
            _state["chat"] = None
            _state["review"] = None
            _state["insight_model"] = None
        try:
            yield
        finally:
            await repo.close()


app = FastAPI(lifespan=lifespan)
app.include_router(rest_api.router)
from .rag.service import router as rag_router  # noqa: E402 — after app config
app.include_router(rag_router)
# PWA origins; tighten for deployment. Override via COACH_CORS_ORIGINS (comma-separated).
_cors_origins = [
    o.strip()
    for o in os.environ.get("COACH_CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cfg(user_id: str, thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id, "user_id": user_id}}


class ChatIn(BaseModel):
    thread_id: str
    message: str


@app.post("/coach/chat")
async def chat(body: ChatIn, user_id: str = Depends(get_current_user_id)):
    graph = _state["chat"]
    if graph is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    config = _cfg(user_id, body.thread_id)
    result = await graph.ainvoke({"messages": [HumanMessage(body.message)]}, config=config)

    snapshot = await graph.aget_state(config)
    pending = [t for t in snapshot.tasks if getattr(t, "interrupts", None)]
    if pending:
        return {"status": "needs_confirmation", "payload": pending[0].interrupts[0].value}
    return {
        "status": "ok",
        "reply": result["messages"][-1].content,
        "evidence": summarize_evidence(result["messages"]),
    }


class ParseWorkoutIn(BaseModel):
    text: str


@app.post("/coach/parse-workout")
async def parse_workout_ep(body: ParseWorkoutIn, user_id: str = Depends(get_current_user_id)):
    """Parse a free-text workout description into structured, catalog-matched entries the user
    can confirm/edit, then log via /api/sets/sync. No DB write here. 503 if no LLM configured."""
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    if not (body.text or "").strip():
        return {"entries": []}
    result = await parse_workout(body.text, model, _state["repo"])
    weight = await _state["repo"].get_latest_weight_kg(user_id)
    for e in result.get("entries", []):
        ex = e.get("exercise") or {}
        e["est_kcal"] = energy.estimate_kcal(ex.get("name", ""), e.get("duration_s"), e.get("distance_m"), weight)
    return result


class FoodPhotoIn(BaseModel):
    image: str  # data URL (downscaled jpeg/png base64) from the device camera
    note: Optional[str] = None


@app.post("/coach/parse-food-photo")
async def parse_food_photo_ep(body: FoodPhotoIn, user_id: str = Depends(get_current_user_id)):
    """Estimate food items + portion grams + macros from a photo, for the user to confirm and
    log. No DB write. 503 if no LLM configured."""
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    if not (body.image or "").startswith("data:image/"):
        return {"items": []}
    return await parse_food_photo(body.image, body.note, model)


_PROGRESS_PHOTO_PROMPT = (
    "You are a supportive fitness coach looking at a user's progress photo. Give 2-3 sentences of "
    "constructive, encouraging feedback on training progress and conditioning — posture, visible "
    "muscle tone or conditioning changes, and what to keep doing. Be respectful and non-judgmental: "
    "never shame, never comment on weight as a number, never use clinical or appearance-shaming "
    "language. If you can't tell much, say so kindly and suggest a consistent angle/lighting next time."
)


class PhotoNoteIn(BaseModel):
    photo_id: str


@app.post("/coach/photo-note")
async def photo_note_ep(body: PhotoNoteIn, user_id: str = Depends(get_current_user_id)):
    """Vision feedback on a progress photo. Disabled for eating-disorder history (no appearance
    framing for at-risk users — consistent with the rest of the safety layer)."""
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    repo = _state["repo"]
    profile = await repo.get_profile(user_id)
    if profile and "eating_disorder_history" in profile.medical_flags:
        return {"note": None, "disabled": True}
    p = await repo.get_photo(user_id, body.photo_id)
    if not p:
        raise HTTPException(404, "photo not found")
    msg = HumanMessage(content=[
        {"type": "text", "text": _PROGRESS_PHOTO_PROMPT},
        {"type": "image_url", "image_url": {"url": media.read_data_url(user_id, p["filename"])}},
    ])
    resp = await model.ainvoke([msg])
    note = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip()[:1000]
    await repo.set_photo_note(user_id, body.photo_id, note)
    return {"note": note, "disabled": False}


class ConfirmIn(BaseModel):
    thread_id: str
    approved: bool


@app.post("/coach/confirm")
async def confirm(body: ConfirmIn, user_id: str = Depends(get_current_user_id)):
    graph = _state["chat"]
    if graph is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    config = _cfg(user_id, body.thread_id)
    result = await graph.ainvoke(Command(resume=body.approved), config=config)
    return {"status": "ok", "reply": result["messages"][-1].content}


class ReviewIn(BaseModel):
    window_days: int = 7


# NOTE: protect this with a service credential, not a user token — it's scheduler-driven.
@app.get("/coach/review/latest")
async def latest_review(user_id: str = Depends(get_current_user_id)):
    return await _state["repo"].get_latest_review(user_id)


@app.post("/coach/review/run")
async def run_review(body: ReviewIn, user_id: str = Depends(get_current_user_id)):
    if _state["review"] is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    out = await _state["review"].ainvoke(
        {"user_id": user_id, "window_days": body.window_days, "committed_changes": {}}
    )
    return {"status": "ok", "assessment": out["assessment"], "changes": out["committed_changes"]}


# Proactive "here's what I noticed" note for the Today screen. Cached per user with a short
# TTL so it isn't regenerated on every open (in-memory: fine for this single-host app).
_insight_cache: dict = {}
_INSIGHT_TTL = 6 * 3600


@app.get("/coach/insight")
async def coach_insight(
    refresh: bool = False,
    focus: str = "auto",
    user_id: str = Depends(get_current_user_id),
):
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    key = (user_id, focus)
    cached = _insight_cache.get(key)
    now = time.time()
    if cached and not refresh and now - cached["ts"] < _INSIGHT_TTL:
        return {"note": cached["note"], "generated_at": cached["iso"], "focus": focus, "cached": True}
    note = await generate_insight(_state["repo"], model, user_id, focus=focus)
    iso = datetime.now(timezone.utc).isoformat()
    _insight_cache[key] = {"note": note, "ts": now, "iso": iso}
    return {"note": note, "generated_at": iso, "focus": focus, "cached": False}
