"""FastAPI wiring (hardened).

`user_id` is no longer accepted from request bodies — it is derived from a verified
JWT via `get_current_user_id`. The chat graph uses a Postgres checkpointer for
persistent memory and resumable confirmation interrupts.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from pydantic import BaseModel

from .auth import get_current_user_id
from .graph import build_coach_graph
from .review import build_review_graph
from .pg_repo import PostgresCoachRepo

DB_URI = os.environ["COACH_DB_URI"]
MODEL_ID = os.environ.get("COACH_MODEL", "openai:gpt-4o")
SEED_DIR = os.environ.get("COACH_SEED_DIR", "./seed")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncPostgresSaver.from_conn_string(DB_URI) as saver:
        await saver.setup()
        repo = await PostgresCoachRepo.create(DB_URI, SEED_DIR)
        _state["repo"] = repo
        _state["chat"] = build_coach_graph(repo, checkpointer=saver, model_id=MODEL_ID)
        _state["review"] = build_review_graph(repo, model_id=MODEL_ID)
        try:
            yield
        finally:
            await repo.close()


app = FastAPI(lifespan=lifespan)


def _cfg(user_id: str, thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id, "user_id": user_id}}


class ChatIn(BaseModel):
    thread_id: str
    message: str


@app.post("/coach/chat")
async def chat(body: ChatIn, user_id: str = Depends(get_current_user_id)):
    graph = _state["chat"]
    config = _cfg(user_id, body.thread_id)
    result = await graph.ainvoke({"messages": [HumanMessage(body.message)]}, config=config)

    snapshot = await graph.aget_state(config)
    pending = [t for t in snapshot.tasks if getattr(t, "interrupts", None)]
    if pending:
        return {"status": "needs_confirmation", "payload": pending[0].interrupts[0].value}
    return {"status": "ok", "reply": result["messages"][-1].content}


class ConfirmIn(BaseModel):
    thread_id: str
    approved: bool


@app.post("/coach/confirm")
async def confirm(body: ConfirmIn, user_id: str = Depends(get_current_user_id)):
    graph = _state["chat"]
    config = _cfg(user_id, body.thread_id)
    result = await graph.ainvoke(Command(resume=body.approved), config=config)
    return {"status": "ok", "reply": result["messages"][-1].content}


class ReviewIn(BaseModel):
    window_days: int = 7


# NOTE: protect this with a service credential, not a user token — it's scheduler-driven.
@app.post("/coach/review/run")
async def run_review(body: ReviewIn, user_id: str = Depends(get_current_user_id)):
    out = await _state["review"].ainvoke(
        {"user_id": user_id, "window_days": body.window_days, "committed_changes": {}}
    )
    return {"status": "ok", "assessment": out["assessment"], "changes": out["committed_changes"]}
