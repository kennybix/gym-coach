"""Deterministic safety layer.

Two responsibilities, both deterministic and pure (so they're trivially testable
and usable as hard CI gates):

  1. MUTATION GATING  — check_target_change / check_program_change / validate_goal_rate.
     Block dangerous plan changes regardless of what the LLM proposed.
  2. CONTENT SCREENING — screen_user_message / screen_coach_reply.
     A cheap inbound+outbound net for disordered-eating, self-harm, extreme-deficit,
     and train-through-injury signals. This is DEFENSE-IN-DEPTH, not the primary
     safeguard: production should layer a trained classifier and clinician-reviewed
     crisis copy on top. Keyword/regex matching here is intentionally conservative.

The threshold constants below are load-bearing guardrails, not diet advice. They MUST
be calibrated with a qualified clinician before launch; the values here are placeholders.
"""
from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel

from .models import Profile, ProposedProgramChange, ProposedTargetChange, SafetyVerdict

# --- tunable guardrail constants (clinician-calibrated placeholders) ----------
ABSOLUTE_KCAL_FLOOR = {"male": 1500, "female": 1200, "other": 1200}
CONFIRM_CUT_BAND = 0.85       # cut to <85% of current target -> require explicit confirmation
REJECT_STEP_CUT_BAND = 0.75   # cut to <75% in a single step -> reject (too aggressive at once)
MAX_SAFE_WEEKLY_RATE_KG = 1.0 # cap on the goal loss rate set at onboarding
MIN_PROTEIN_G, MAX_PROTEIN_G = 0, 400


# =============================================================================
# 1. Mutation gating
# =============================================================================
def check_target_change(
    profile: Profile,
    current_kcal: Optional[int],
    proposed: ProposedTargetChange,
) -> SafetyVerdict:
    if "eating_disorder_history" in profile.medical_flags:
        return SafetyVerdict(
            approved=False,
            reason=(
                "User flagged a history of disordered eating; automated calorie-target "
                "changes are disabled. Route to specialized professional support."
            ),
        )

    floor = ABSOLUTE_KCAL_FLOOR.get(profile.sex.value, 1200)
    if proposed.new_daily_kcal < floor:
        return SafetyVerdict(
            approved=False,
            reason="Proposed target is below the safe minimum for this user.",
        )

    if not (MIN_PROTEIN_G <= proposed.new_protein_g <= MAX_PROTEIN_G):
        return SafetyVerdict(approved=False, reason="Proposed protein target is out of plausible range.")

    if current_kcal:
        if proposed.new_daily_kcal < current_kcal * REJECT_STEP_CUT_BAND:
            return SafetyVerdict(
                approved=False,
                reason="That is too large a single-step reduction; adjust gradually instead.",
            )
        if proposed.new_daily_kcal < current_kcal * CONFIRM_CUT_BAND:
            return SafetyVerdict(
                approved=True,
                reason="Reduction is within bounds but sizeable.",
                requires_user_confirmation=True,
            )

    return SafetyVerdict(approved=True, reason="Within safe bounds.")


def check_program_change(profile: Profile, proposed: ProposedProgramChange) -> SafetyVerdict:
    if "injury_active" in profile.medical_flags:
        return SafetyVerdict(
            approved=False,
            reason="Active injury flagged; program intensification is disabled until cleared.",
        )
    for e in proposed.edits:
        if (e.sets is not None and e.sets < 0) or (e.reps is not None and e.reps < 0):
            return SafetyVerdict(approved=False, reason="Program edit has invalid (negative) values.")
        if e.load_kg is not None and e.load_kg < 0:
            return SafetyVerdict(approved=False, reason="Program edit has invalid (negative) load.")
    return SafetyVerdict(approved=True, reason="No contraindication found.")


def validate_goal_rate(profile: Profile) -> SafetyVerdict:
    """Run at onboarding / whenever the goal rate is set."""
    if profile.weekly_rate_kg > MAX_SAFE_WEEKLY_RATE_KG:
        return SafetyVerdict(
            approved=False,
            reason="Requested loss rate exceeds the safe weekly maximum; clamp to a sustainable pace.",
        )
    return SafetyVerdict(approved=True, reason="Goal rate is sustainable.")


# =============================================================================
# 2. Content screening (defense-in-depth net; replace/augment with a classifier)
# =============================================================================
class ScreenResult(BaseModel):
    flagged: bool
    category: Optional[str] = None  # disordered_eating | self_harm | extreme_deficit | train_through_injury
    posture: Optional[str] = None   # guidance handed to the model / used to pick safe copy


# Intentionally small, high-precision sets. NOT exhaustive — a classifier is the
# production layer. Matched as lowercased substrings unless noted.
_DISORDERED_EATING = (
    "pro ana", "proana", "thinspo", "make myself throw up", "purge", "purging",
    "starve myself", "stop eating completely", "laxative", "not eat for days",
)
_SELF_HARM = ("hurt myself", "kill myself", "want to die", "end my life", "self harm", "self-harm")
_TRAIN_THROUGH_INJURY = (
    "train through the pain", "work out with my injury", "ignore the injury",
    "push through the injury",
)
_EXTREME_DEFICIT = ("starve", "skip all meals", "stop eating")

# rapid-loss promise, e.g. "lose 10 lbs in a week"
_RAPID_LOSS = re.compile(
    r"lose\s+(\d+)\s*(lbs?|pounds?|kgs?|kilograms?)\s+in\s+(a|one|1|the\s+next)\s*(day|week)",
    re.IGNORECASE,
)


def _contains(text: str, terms) -> bool:
    t = text.lower()
    return any(term in t for term in terms)


def _is_rapid_loss(text: str) -> bool:
    m = _RAPID_LOSS.search(text)
    if not m:
        return False
    n, unit = int(m.group(1)), m.group(2).lower()
    per_week_threshold = 2 if unit.startswith(("lb", "pound")) else 1  # ~max safe weekly loss
    return n > per_week_threshold


def screen_user_message(text: str) -> ScreenResult:
    if _contains(text, _SELF_HARM):
        return ScreenResult(
            flagged=True, category="self_harm",
            posture="Respond with warmth and concern, do not give diet/fitness content, "
                    "and gently offer to help find appropriate support.",
        )
    if _contains(text, _DISORDERED_EATING):
        return ScreenResult(
            flagged=True, category="disordered_eating",
            posture="Do NOT provide numbers, meal plans, or restriction advice. Validate the "
                    "feeling, do less rather than more, and keep the path to specialized support open.",
        )
    if _is_rapid_loss(text) or _contains(text, _EXTREME_DEFICIT):
        return ScreenResult(
            flagged=True, category="extreme_deficit",
            posture="Decline the unsafe framing; explain sustainable pace without prescribing aggressive numbers.",
        )
    if _contains(text, _TRAIN_THROUGH_INJURY):
        return ScreenResult(
            flagged=True, category="train_through_injury",
            posture="Do not encourage training through injury; advise rest/assessment.",
        )
    return ScreenResult(flagged=False)


def screen_coach_reply(text: str) -> ScreenResult:
    """Outbound guard: catch unsafe content the model may have produced anyway."""
    if _contains(text, _DISORDERED_EATING):
        return ScreenResult(flagged=True, category="disordered_eating")
    if _is_rapid_loss(text) or _contains(text, _EXTREME_DEFICIT):
        return ScreenResult(flagged=True, category="extreme_deficit")
    if _contains(text, _TRAIN_THROUGH_INJURY):
        return ScreenResult(flagged=True, category="train_through_injury")
    return ScreenResult(flagged=False)
