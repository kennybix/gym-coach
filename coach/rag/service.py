"""Knowledge endpoint — behind the same verified-token auth as the coach.

Production wiring: retrieves from the pgvector corpus (migration 004) and generates a
cited answer with the real LLM, both screened by the shared safety layer. The store is
sync (psycopg), so the async route runs the work in a threadpool under a lock (single
shared connection). Everything is built lazily and degrades gracefully: if no embeddings
backend / LLM is configured, the endpoint reports that instead of crashing the app.
"""
from __future__ import annotations

import logging
import os
import threading

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from ..auth import get_current_user_id
from .answer import NO_SOURCE, answer
from .models import CitedAnswer

router = APIRouter()

_lock = threading.Lock()
_state: dict = {}


def _components():
    """Lazily build (store, embedder, generator), caching on success."""
    if "store" not in _state:
        from .answer import Generator
        from .embeddings import build_embedder
        from .pgvector_store import PgVectorStore
        _state["store"] = PgVectorStore(os.environ["COACH_DB_URI"])
        _state["embedder"] = build_embedder()
        _state["generator"] = Generator()
    return _state["store"], _state["embedder"], _state["generator"]


def _answer_sync(question: str) -> CitedAnswer:
    with _lock:
        store, embedder, generator = _components()
        return answer(question, store, embedder=embedder, generator=generator)


class AskIn(BaseModel):
    question: str


@router.post("/knowledge/ask")
async def ask(body: AskIn, user_id: str = Depends(get_current_user_id)) -> dict:
    try:
        result = await run_in_threadpool(_answer_sync, body.question)
        return result.model_dump()
    except Exception:  # embeddings/LLM/store not configured — honest, non-fatal
        logging.exception("knowledge/ask failed; returning no-source")
        _state.clear()  # allow a later request to rebuild
        return CitedAnswer(answer=NO_SOURCE, citations=[], grounded=False).model_dump()
