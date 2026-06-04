"""LLM-as-judge for grounding + usefulness, with a bounded justification.

The judge scores a coach turn against the tool results it had available. Grounding asks
"are the claims supported by the data, with nothing invented?"; usefulness asks "does the
action (or the decision to hold) follow from the data?". The justification is length-bounded
so the judge commits to a verdict rather than rationalizing at length.

`Judge` calls a real model (provider-agnostic). `FakeJudge` is deterministic for CI.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class JudgeVerdict(BaseModel):
    grounding: int = Field(ge=1, le=5, description="1=claims contradict the data, 5=fully supported")
    usefulness: int = Field(ge=1, le=5, description="1=action ignores the data, 5=clearly follows from it")
    justification: str = Field(max_length=240, description="Bounded rationale; commit to the verdict")


JUDGE_PROMPT = (
    "You are grading one turn from a weight-loss coach. You are given the tool results the "
    "coach could see, its reply, and any action it took. Score GROUNDING (are the reply's "
    "claims supported by the tool results, with nothing invented?) and USEFULNESS (does the "
    "action or the decision to hold follow from the data?), each 1-5. Justify in <=240 chars."
)


def build_judge_input(context: dict) -> str:
    return (
        JUDGE_PROMPT
        + "\n\nTOOL RESULTS:\n" + str(context.get("tool_results"))
        + "\n\nACTION:\n" + str(context.get("action"))
        + "\n\nCOACH REPLY:\n" + str(context.get("reply"))
    )


class Judge:
    def __init__(self, model_id=None):
        import os
        from langchain.chat_models import init_chat_model
        model_id = model_id or os.environ.get("COACH_JUDGE_MODEL", "google_genai:gemini-3.5-flash")
        self._llm = init_chat_model(model_id, temperature=0).with_structured_output(JudgeVerdict)

    async def score(self, context: dict) -> JudgeVerdict:
        return await self._llm.ainvoke(build_judge_input(context))


class FakeJudge:
    """Deterministic stand-in: grounding keys off whether the reply's progress framing
    matches the actual trend direction in the tool results."""
    _PROGRESS = ("progress", "ahead", "crushing", "dropped", "huge", "way ahead")

    async def score(self, context: dict) -> JudgeVerdict:
        reply = str(context.get("reply", "")).lower()
        sign = context.get("trend_sign")
        claims_strong_progress = any(w in reply for w in self._PROGRESS)
        if sign == "down":
            grounding = 5
        elif sign in ("flat", "up") and claims_strong_progress:
            grounding = 2  # claims progress the data doesn't support
        else:
            grounding = 4
        return JudgeVerdict(grounding=grounding, usefulness=4, justification="deterministic fake judge")
