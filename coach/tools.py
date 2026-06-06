"""Coach tools.

Read tools fetch real rows so the model can ground every claim.
Propose tools do NOT write — they stage a typed proposal into graph state and let
the safety gate decide. `user_id` is injected from RunnableConfig, so the model
cannot pass an id for another user.
"""
from __future__ import annotations

from typing import Annotated

from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.types import Command

from .models import ProgramExerciseEdit, ProposedProgramChange, ProposedTargetChange
from .repo import CoachRepo


def build_read_tools(repo: CoachRepo) -> list:
    @tool
    async def get_weight_trend(window_days: int, config: RunnableConfig) -> str:
        """Smoothed body-weight trend over the window. Call before any claim about progress."""
        uid = config["configurable"]["user_id"]
        return (await repo.get_weight_trend(uid, window_days)).model_dump_json()

    @tool
    async def get_adherence(window_days: int, config: RunnableConfig) -> str:
        """Prescribed vs completed training sessions and sets over the window."""
        uid = config["configurable"]["user_id"]
        return (await repo.get_adherence(uid, window_days)).model_dump_json()

    @tool
    async def get_nutrition_summary(window_days: int, config: RunnableConfig) -> str:
        """Average intake vs target and logging consistency over the window."""
        uid = config["configurable"]["user_id"]
        return (await repo.get_nutrition_summary(uid, window_days)).model_dump_json()

    @tool
    async def get_current_targets(config: RunnableConfig) -> str:
        """The user's active calorie/protein targets."""
        uid = config["configurable"]["user_id"]
        t = await repo.get_current_targets(uid)
        return t.model_dump_json() if t else "{}"

    @tool
    async def get_recent_vitals(window_days: int, config: RunnableConfig) -> str:
        """The user's logged blood-pressure and resting/heart-rate readings over the window
        (summary: latest, averages, resting HR, range). Use to reference vitals trends in your
        guidance. These are self-logged monitoring data, not clinical measurements — encourage
        the user to have a genuinely concerning reading checked by a healthcare professional."""
        import json
        uid = config["configurable"]["user_id"]
        return json.dumps(await repo.get_vitals_summary(uid, window_days))

    @tool
    async def get_today_plan(config: RunnableConfig) -> str:
        """The active program's exercises with target sets×reps and the system's deterministic
        next-load suggestion per lift (suggested_kg + reason, from the last working set). Use to
        explain progression — never invent a load; cite suggested_kg."""
        import json
        uid = config["configurable"]["user_id"]
        slots = await repo.get_program_slots(uid)
        compact = [
            {"name": s["name"], "sets": s["sets"], "reps": s["reps"],
             "suggested_kg": s.get("suggested_kg"), "reason": s.get("suggested_reason")}
            for s in slots
        ]
        return json.dumps(compact)

    return [get_weight_trend, get_adherence, get_nutrition_summary, get_current_targets,
            get_recent_vitals, get_today_plan]


def build_propose_tools(repo: CoachRepo) -> list:
    @tool
    async def propose_target_change(
        new_daily_kcal: int,
        new_protein_g: int,
        rationale: str,
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        """Propose a new daily calorie/protein target. Does NOT apply it — the system
        safety-checks and commits. Provide a rationale grounded in the user's data."""
        proposal = ProposedTargetChange(
            new_daily_kcal=new_daily_kcal,
            new_protein_g=new_protein_g,
            rationale=rationale,
        )
        return Command(
            update={
                "pending_mutation": proposal.model_dump(),
                "messages": [
                    ToolMessage(
                        "Target change staged for safety review.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    @tool
    async def propose_program_change(
        edits: list[dict],
        rationale: str,
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        """Propose edits to upcoming program exercises (sets/reps/load). Does NOT apply them."""
        proposal = ProposedProgramChange(
            edits=[ProgramExerciseEdit(**e) for e in edits],
            rationale=rationale,
        )
        return Command(
            update={
                "pending_mutation": proposal.model_dump(),
                "messages": [
                    ToolMessage(
                        "Program change staged for safety review.",
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    @tool
    async def propose_equipment_swap(
        available_equipment: list[str],
        rationale: str,
        tool_call_id: Annotated[str, InjectedToolCallId],
        config: RunnableConfig,
    ) -> Command:
        """Rebuild the user's current program for the equipment they actually have, swapping
        each unavailable movement to a same-pattern variant. Does NOT apply changes — stages
        a program change for safety review. Pass the equipment the user has, e.g. ["none"] for
        bodyweight-only (traveling), or ["dumbbell", "band"] for a home setup."""
        uid = config["configurable"]["user_id"]
        available = set(available_equipment)
        current = await repo.get_program_exercises(uid)

        edits, summary = [], []
        for pe in current:
            if pe.equipment in available:
                continue  # already doable with what they have
            variant = await repo.find_equipment_variant(pe.exercise_id, available)
            if variant:
                edits.append(
                    ProgramExerciseEdit(
                        program_exercise_id=pe.program_exercise_id,
                        swap_to_exercise_id=variant.exercise_id,
                    )
                )
                summary.append(f"{pe.name} -> {variant.name}")

        if not edits:
            return Command(
                update={
                    "messages": [
                        ToolMessage(
                            "No swaps needed, or no matching variants exist for the "
                            "unavailable equipment. Tell the user honestly rather than forcing a swap.",
                            tool_call_id=tool_call_id,
                        )
                    ]
                }
            )

        proposal = ProposedProgramChange(edits=edits, rationale=rationale)
        return Command(
            update={
                "pending_mutation": proposal.model_dump(),
                "messages": [
                    ToolMessage(
                        "Equipment swap staged for safety review: " + "; ".join(summary),
                        tool_call_id=tool_call_id,
                    )
                ],
            }
        )

    return [propose_target_change, propose_program_change, propose_equipment_swap]
