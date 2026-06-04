"""Domain models for the coach.

Pydantic everywhere: same models validate DB reads, structured LLM outputs, and
the proposals that flow through the safety gate. One source of truth for shape.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Sex(str, Enum):
    male = "male"
    female = "female"
    other = "other"


class ActivityLevel(str, Enum):
    sedentary = "sedentary"
    light = "light"
    moderate = "moderate"
    active = "active"


class Profile(BaseModel):
    user_id: str
    sex: Sex
    birth_year: int
    height_cm: float
    activity_level: ActivityLevel
    goal_weight_kg: float
    weekly_rate_kg: float = Field(..., description="Target loss per week; positive = loss")
    # screening flags captured at onboarding that gate aggressive features
    medical_flags: list[str] = Field(default_factory=list)
    current_target_id: Optional[str] = None


# ---- read-tool return shapes ------------------------------------------------

class WeightTrend(BaseModel):
    window_days: int
    start_kg: Optional[float]
    latest_kg: Optional[float]
    smoothed_slope_kg_per_week: Optional[float]
    n_points: int


class AdherenceSummary(BaseModel):
    window_days: int
    sessions_prescribed: int
    sessions_completed: int
    sets_prescribed: int
    sets_completed: int

    @property
    def session_rate(self) -> float:
        return self.sessions_completed / self.sessions_prescribed if self.sessions_prescribed else 0.0


class NutritionSummary(BaseModel):
    window_days: int
    days_logged: int
    avg_kcal: Optional[float]
    target_kcal: Optional[int]
    avg_protein_g: Optional[float]


class Targets(BaseModel):
    target_id: Optional[str] = None
    daily_kcal: int
    protein_g: int
    source: Literal["onboarding", "coach_review", "coach_chat", "manual"]
    rationale: str
    created_at: Optional[datetime] = None


# ---- proposed mutations (LLM-generated, never written directly) -------------

class ProposedTargetChange(BaseModel):
    kind: Literal["target_change"] = "target_change"
    new_daily_kcal: int
    new_protein_g: int
    rationale: str


class ProgramExerciseEdit(BaseModel):
    program_exercise_id: str
    sets: Optional[int] = None
    reps: Optional[int] = None
    load_kg: Optional[float] = None
    # When set, the program slot is re-pointed to a different exercise (an equipment swap).
    swap_to_exercise_id: Optional[str] = None


class ProposedProgramChange(BaseModel):
    kind: Literal["program_change"] = "program_change"
    edits: list[ProgramExerciseEdit]
    rationale: str


class ProgramExerciseRef(BaseModel):
    """A slot in the user's current program, used to compute equipment swaps."""
    program_exercise_id: str
    exercise_id: str
    name: str
    equipment: str


class VariantMatch(BaseModel):
    """An alternative exercise (same movement, different equipment) from the catalog."""
    exercise_id: str
    name: str
    equipment: str


# ---- safety + review --------------------------------------------------------

class SafetyVerdict(BaseModel):
    approved: bool
    reason: str
    requires_user_confirmation: bool = False


class ReviewStatus(str, Enum):
    on_track = "on_track"
    ahead = "ahead"
    behind = "behind"
    stalled = "stalled"
    insufficient_data = "insufficient_data"


class ReviewAssessment(BaseModel):
    """Structured output of the weekly review LLM call."""
    status: ReviewStatus
    summary: str = Field(..., description="2-4 sentences the user will read")
    proposed_target_change: Optional[ProposedTargetChange] = None
    proposed_program_change: Optional[ProposedProgramChange] = None
