"""Data access boundary.

The coach service connects to Postgres with a service role (it bypasses RLS), so
THIS interface is the isolation boundary. Every method is scoped by an explicit
`user_id`, and that id always originates from request config — never from
model-generated content. Your concrete implementation should also defensively add
`WHERE user_id = $1` to every query.
"""
from __future__ import annotations

from typing import Optional, Protocol

from .models import (
    AdherenceSummary,
    NutritionSummary,
    Profile,
    ProgramExerciseRef,
    ProposedProgramChange,
    Targets,
    VariantMatch,
    WeightTrend,
)


class CoachRepo(Protocol):
    # reads
    async def get_profile(self, user_id: str) -> Profile: ...
    async def get_weight_trend(self, user_id: str, window_days: int) -> WeightTrend: ...
    async def get_adherence(self, user_id: str, window_days: int) -> AdherenceSummary: ...
    async def get_nutrition_summary(self, user_id: str, window_days: int) -> NutritionSummary: ...
    async def get_adaptive_estimate(self, user_id: str, window_days: int = 28): ...  # -> adaptive.AdaptiveEstimate
    async def get_current_targets(self, user_id: str) -> Optional[Targets]: ...

    # catalog / program reads (back the equipment-swap tool)
    async def get_program_exercises(self, user_id: str) -> list[ProgramExerciseRef]: ...
    async def find_equipment_variant(
        self, exercise_id: str, available_equipment: set[str]
    ) -> Optional[VariantMatch]: ...

    # writes (append-only / scoped)
    async def insert_target(self, user_id: str, targets: Targets) -> Targets: ...
    async def apply_program_change(self, user_id: str, change: ProposedProgramChange) -> None: ...
    async def record_review(
        self, user_id: str, status: str, summary: str, changes: dict
    ) -> str: ...
