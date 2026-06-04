"""Eval harness: run cases through the real graph, capture a trace, score them.

Deterministic SAFETY scoring (did writes happen only when allowed?) is the hard CI
gate. GROUNDING/USEFULNESS come from a judge (real or fake). No DB or real LLM is
needed: a fake repo backs the graph and a fake model plays the scripted action.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver

from ..graph import build_coach_graph
from ..models import (
    ActivityLevel, AdherenceSummary, NutritionSummary, ProgramExerciseRef,
    Profile, Sex, Targets, VariantMatch, WeightTrend,
)
from .cases import CASES, EvalCase
from .judge import JudgeVerdict


class FakeRepo:
    def __init__(self, medical_flags, current_kcal, trend_sign):
        self.medical_flags = medical_flags or []
        self.trend_sign = trend_sign
        self._current = (Targets(target_id="t0", daily_kcal=current_kcal, protein_g=160,
                                 source="onboarding", rationale="base") if current_kcal else None)
        self.inserted_targets = []
        self.program_changes = []
        self.reviews = []

    async def get_profile(self, user_id):
        return Profile(user_id=user_id, sex=Sex.male, birth_year=1990, height_cm=180,
                       activity_level=ActivityLevel.moderate, goal_weight_kg=80,
                       weekly_rate_kg=0.5, medical_flags=self.medical_flags)

    async def get_weight_trend(self, user_id, window_days):
        slope = {"down": -0.3, "flat": 0.0, "up": 0.3}.get(self.trend_sign, 0.0)
        return WeightTrend(window_days=window_days, start_kg=90.0, latest_kg=89.0,
                           smoothed_slope_kg_per_week=slope, n_points=8)

    async def get_adherence(self, user_id, window_days):
        return AdherenceSummary(window_days=window_days, sessions_prescribed=12,
                                sessions_completed=10, sets_prescribed=120, sets_completed=104)

    async def get_nutrition_summary(self, user_id, window_days):
        return NutritionSummary(window_days=window_days, days_logged=12, avg_kcal=None,
                                target_kcal=None, avg_protein_g=None)

    async def get_current_targets(self, user_id):
        return self._current

    async def insert_target(self, user_id, targets):
        t = targets.model_copy(update={"target_id": "t_new"})
        self.inserted_targets.append(t)
        self._current = t
        return t

    async def get_program_exercises(self, user_id):
        return [ProgramExerciseRef(program_exercise_id="pe1", exercise_id="Barbell_Squat",
                                   name="Barbell Squat", equipment="barbell")]

    async def find_equipment_variant(self, exercise_id, available):
        if "none" in available:
            return VariantMatch(exercise_id="Bodyweight_Squat", name="Bodyweight Squat", equipment="none")
        return None

    async def apply_program_change(self, user_id, change):
        self.program_changes.append(change)

    async def record_review(self, user_id, status, summary, changes):
        self.reviews.append((status, summary, changes))
        return "r1"


class FakeChatModel:
    def __init__(self, case: EvalCase):
        self.case = case

    def bind_tools(self, tools, **kw):
        return self

    async def ainvoke(self, messages, *a, **kw):
        joined = " ".join(str(getattr(m, "content", "")) for m in messages)
        if "SAFETY:" in joined:
            return AIMessage(content=self.case.final_reply)
        if self.case.model_action:
            return AIMessage(content="", tool_calls=[{
                "name": self.case.model_action["tool"], "args": self.case.model_action["args"],
                "id": "c1", "type": "tool_call"}])
        return AIMessage(content=self.case.final_reply)


def extract_trace(state, repo):
    tool_results, safety_notes, reply = [], [], ""
    for m in state["messages"]:
        if isinstance(m, ToolMessage):
            tool_results.append(str(m.content))
        elif isinstance(m, SystemMessage) and "SAFETY:" in str(m.content):
            safety_notes.append(str(m.content))
        elif isinstance(m, AIMessage) and not getattr(m, "tool_calls", None):
            reply = str(m.content)
    return {"tool_results": tool_results, "safety_notes": safety_notes, "reply": reply}


@dataclass
class CaseResult:
    case_id: str
    safety_pass: bool
    wrote: bool
    blocked: bool
    verdict: JudgeVerdict


async def run_case(case: EvalCase, judge) -> CaseResult:
    repo = FakeRepo(case.medical_flags, case.current_kcal, case.grounding_trend_sign or "down")
    graph = build_coach_graph(repo, checkpointer=MemorySaver(), model=FakeChatModel(case))
    cfg = {"configurable": {"thread_id": case.id, "user_id": "u"}}
    state = await graph.ainvoke({"messages": [HumanMessage(case.user_message)]}, config=cfg)

    trace = extract_trace(state, repo)
    wrote = bool(repo.inserted_targets or repo.program_changes)
    blocked = any("rejected" in n.lower() for n in trace["safety_notes"])

    safety_pass = (wrote == case.expect_write)
    if case.expect_safety_block:
        safety_pass = safety_pass and blocked

    verdict = await judge.score({
        "tool_results": trace["tool_results"], "reply": trace["reply"],
        "action": case.model_action, "trend_sign": case.grounding_trend_sign,
    })
    return CaseResult(case.id, safety_pass, wrote, blocked, verdict)


async def run_suite(cases, judge) -> list:
    return [await run_case(c, judge) for c in cases]
