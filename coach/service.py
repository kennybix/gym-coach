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

import openai
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from pydantic import BaseModel

from fastapi.middleware.cors import CORSMiddleware

from . import api as rest_api
from .auth import get_current_user_id, require_jwt_secret
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
    # Fail closed: without a signing secret every endpoint would accept forged tokens.
    require_jwt_secret()
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


@app.exception_handler(openai.APIError)
async def _llm_unavailable(request, exc):
    # LLM provider hiccup (rate-limit/cooldown, connection, upstream error) -> graceful 503, not a
    # hard 500. The PWA already treats coach 503s as "coach unavailable" instead of crashing.
    logging.warning("coach LLM unavailable -> 503: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "coach temporarily unavailable — the model is busy, try again shortly"})


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
    repo = _state["repo"]
    # Invoke FIRST, persist after: saving the user message up front left orphaned/duplicated
    # turns in the transcript whenever the LLM errored and the user retried.
    result = await graph.ainvoke({"messages": [HumanMessage(body.message)]}, config=config)

    snapshot = await graph.aget_state(config)
    pending = [t for t in snapshot.tasks if getattr(t, "interrupts", None)]
    if pending:
        payload = pending[0].interrupts[0].value
        await repo.save_coach_message(user_id, body.thread_id, "user", body.message)
        # record the proposal too, so a restored thread shows what the follow-up reply approved
        reason = (payload or {}).get("reason") if isinstance(payload, dict) else None
        await repo.save_coach_message(user_id, body.thread_id, "coach",
                                      f"Proposed a change{f': {reason}' if reason else ''} (awaiting your approve/decline).")
        return {"status": "needs_confirmation", "payload": payload}
    reply = result["messages"][-1].content
    evidence = summarize_evidence(result["messages"])
    await repo.save_coach_message(user_id, body.thread_id, "user", body.message)
    await repo.save_coach_message(user_id, body.thread_id, "coach", reply, evidence or None)
    return {"status": "ok", "reply": reply, "evidence": evidence}


@app.get("/coach/threads")
async def coach_threads(user_id: str = Depends(get_current_user_id)):
    return {"threads": await _state["repo"].list_coach_threads(user_id)}


@app.get("/coach/threads/{thread_id}")
async def coach_thread_messages(thread_id: str, user_id: str = Depends(get_current_user_id)):
    return {"messages": await _state["repo"].get_coach_messages(user_id, thread_id)}


class DesignProgramIn(BaseModel):
    goal: str


@app.post("/coach/design-program")
async def design_program_ep(body: DesignProgramIn, user_id: str = Depends(get_current_user_id)):
    """Generate a structured weekly program for a free-text goal (e.g. 'kegels', 'better posture').
    Returns it for the user to review/edit; nothing is written until they install via /api/programs."""
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    if not (body.goal or "").strip():
        raise HTTPException(422, "tell me a goal")
    repo = _state["repo"]
    try:
        p = await repo.get_profile(user_id)
        psum = f"sex {p.sex}, activity {p.activity_level}"
    except LookupError:
        psum = "unknown"
    from .programs import design_program
    return await design_program(body.goal.strip(), psum, repo._catalog, model)


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
        if e.get("duration_s"):
            e["est_kcal"] = energy.estimate_kcal(ex.get("name", ""), e.get("duration_s"), e.get("distance_m"), weight)
        else:
            e["est_kcal"] = energy.strength_kcal(weight, e.get("sets") or 1)
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
    "You are a supportive fitness coach looking at a user's progress photo. Reply in two short "
    "parts:\n"
    "1) One or two sentences of encouraging, factual observation — posture, visible muscle tone or "
    "conditioning, what looks like it's working.\n"
    "2) 'Recommendations:' then 2-3 specific, actionable training suggestions (e.g. a muscle group "
    "or movement to emphasise, a posture cue, a consistency tip).\n"
    "Be respectful and non-judgmental: never shame, never comment on weight as a number, never use "
    "clinical or appearance-shaming language, and don't give medical advice. If you can't tell much "
    "from the photo, say so kindly and suggest a consistent angle/lighting and good lighting next time."
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


_COMPARE_PROMPT = (
    "Compare two progress photos of the same person — A is the earlier one, B is more recent. In "
    "2-4 sentences, note visible changes between them in conditioning, posture, and muscle tone, "
    "constructively and factually, and end with one thing to keep doing. Be encouraging and "
    "non-judgmental: never shame, never comment on weight as a number, never use clinical or "
    "appearance-shaming language, and don't give medical advice. If the photos are too different "
    "in angle/lighting to compare fairly, say so kindly and suggest matching the setup next time."
)


class PhotoCompareIn(BaseModel):
    a: str  # earlier photo id
    b: str  # later photo id


@app.post("/coach/compare-photos")
async def compare_photos_ep(body: PhotoCompareIn, user_id: str = Depends(get_current_user_id)):
    """Vision comparison of two progress photos (before/after). Disabled for eating-disorder
    history, like single-photo feedback."""
    model = _state.get("insight_model")
    if model is None:
        raise HTTPException(503, "coach unavailable: LLM provider not configured")
    repo = _state["repo"]
    profile = await repo.get_profile(user_id)
    if profile and "eating_disorder_history" in profile.medical_flags:
        return {"note": None, "disabled": True}
    pa = await repo.get_photo(user_id, body.a)
    pb = await repo.get_photo(user_id, body.b)
    if not pa or not pb:
        raise HTTPException(404, "photo not found")
    msg = HumanMessage(content=[
        {"type": "text", "text": _COMPARE_PROMPT},
        {"type": "text", "text": "Photo A (earlier):"},
        {"type": "image_url", "image_url": {"url": media.read_data_url(user_id, pa["filename"])}},
        {"type": "text", "text": "Photo B (more recent):"},
        {"type": "image_url", "image_url": {"url": media.read_data_url(user_id, pb["filename"])}},
    ])
    resp = await model.ainvoke([msg])
    note = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip()[:1000]
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
    reply = result["messages"][-1].content
    await _state["repo"].save_coach_message(user_id, body.thread_id, "coach", reply)
    return {"status": "ok", "reply": reply}


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


# Proactive "here's what I noticed" note for Home. Cached per user with a short
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
