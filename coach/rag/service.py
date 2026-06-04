"""Knowledge endpoint — behind the same verified-token auth as the coach."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import get_current_user_id
from .answer import answer
from .pipeline import InMemoryVectorStore  # production: a pgvector-backed store

router = APIRouter()
_store = InMemoryVectorStore()  # production: connect/load the vetted corpus index at startup


class AskIn(BaseModel):
    question: str


@router.post("/knowledge/ask")
async def ask(body: AskIn, user_id: str = Depends(get_current_user_id)):
    return answer(body.question, _store).model_dump()
