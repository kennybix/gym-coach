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

from datetime import date

import os
import re
from typing import Optional

from pydantic import BaseModel

from .models import Profile, ProposedProgramChange, ProposedTargetChange, SafetyVerdict

# --- guardrail constants --------------------------------------------------------
# These are evidence-ALIGNED defaults, not a clinician's sign-off. Each is referenced to
# published general-population guidance below; a qualified clinician must still review and
# confirm them for the intended user before any launch (see deploy/SAFETY_REVIEW.md).
# NOT individualized medical advice — they are conservative population-level floors/caps.
#
#   ABSOLUTE_KCAL_FLOOR — widely-cited public guidance: intake should not fall below
#     ~1200 kcal/day for women or ~1500 kcal/day for men except under professional
#     supervision; very-low-calorie diets (<800 kcal) are medical-supervision-only.
#     (Refs: NHS "Very low calorie diets"; Harvard Health; cf. CDC Healthy Weight.)
#   MAX_SAFE_WEEKLY_RATE_KG — CDC & NHS: a gradual ~0.5–1 kg (1–2 lb) per week is the
#     sustainable, evidence-backed rate; faster risks muscle/nutrient loss, gallstones.
#     Capped at the 1.0 kg/week upper bound. (Refs: CDC "Steps for Losing Weight"; NHS.)
#   CONFIRM_CUT_BAND / REJECT_STEP_CUT_BAND — conservative single-step heuristics (not a
#     published number): a >15% cut needs explicit confirmation; a >25% single-step cut is
#     rejected in favour of gradual adjustment. Tune with the reviewing clinician.
#   MIN/MAX_PROTEIN_G — plausibility bounds, not a recommendation.
ABSOLUTE_KCAL_FLOOR = {"male": 1500, "female": 1200, "other": 1200}
CONFIRM_CUT_BAND = 0.85       # cut to <85% of current target -> require explicit confirmation
REJECT_STEP_CUT_BAND = 0.75   # cut to <75% in a single step -> reject (too aggressive at once)
MAX_SAFE_WEEKLY_RATE_KG = 1.0 # cap on the goal loss rate (CDC/NHS upper bound)
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
_EXTREME_DEFICIT = ("starve", "skip all meals", "stop eating", "crash diet", "vlcd")

# rapid-loss promise, e.g. "lose 10 lbs in a week"
_RAPID_LOSS = re.compile(
    r"lose\s+(\d+)\s*(lbs?|pounds?|kgs?|kilograms?)\s+in\s+(a|one|1|the\s+next)\s*(day|week)",
    re.IGNORECASE,
)

# Very-low daily calorie INTAKE, below the absolute floor — two framings:
#   "<n> calories a day"           and   "eat/consume/limit to <n> calories"
# Flag only when n is below this threshold (kept at the lowest floor). Used INBOUND only;
# the coach quotes low numbers when *refusing* them, so the outbound guard must not match.
LOW_KCAL_INTAKE_THRESHOLD = 1200
_KCAL_PER_DAY = re.compile(
    r"(\d{3,4})\s*(?:k?cals?|kcal|calories?)\s*(?:a|per|/|each)\s*day", re.IGNORECASE
)
_KCAL_INTAKE_CUE = re.compile(
    r"(?:eat|eating|ate|consume|consuming|survive on|surviving on|live on|living on|"
    r"only|just|restrict\w*\s+to|limit\w*\s+to|down to|net|intake of)\D{0,20}"
    r"(\d{3,4})\s*(?:k?cals?|kcal|calories?)",
    re.IGNORECASE,
)

# Rapid-loss INTENT without a number: a loss cue AND a speed cue both present.
_LOSS_CUE = (
    "lose weight", "losing weight", "lose fat", "losing fat", "weight loss",
    "fat loss", "drop weight", "shed weight", "slim down", "lose as much",
)
_SPEED_CUE = (
    "as fast as possible", "as quickly as possible", "as fast as i can",
    "as fast as i possibly", "asap", "fastest way", "fastest possible",
    "super fast", "really fast", "extremely fast", "as rapidly as", "rapidly",
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


def _is_low_kcal_intake(text: str) -> bool:
    """True if the message states a daily calorie INTAKE below the floor."""
    for rx in (_KCAL_PER_DAY, _KCAL_INTAKE_CUE):
        for m in rx.finditer(text):
            if int(m.group(1)) < LOW_KCAL_INTAKE_THRESHOLD:
                return True
    return False


def _is_rapid_loss_intent(text: str) -> bool:
    t = text.lower()
    return any(c in t for c in _LOSS_CUE) and any(c in t for c in _SPEED_CUE)


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
    if (
        _is_rapid_loss(text)
        or _is_low_kcal_intake(text)
        or _is_rapid_loss_intent(text)
        or _contains(text, _EXTREME_DEFICIT)
    ):
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


# =============================================================================
# 3. Canonical crisis/redirect copy (single source of truth)
# =============================================================================
# Shared by the coach graph AND the RAG answerer so safety copy can't drift between
# surfaces. The support resource is operator-configured per region: set
# COACH_SUPPORT_RESOURCE to a CURRENT, region-correct, clinician-reviewed service.
# Do NOT hardcode a national helpline that may be disconnected or out of region —
# e.g. do NOT use the NEDA Helpline, which has been discontinued. Defaults empty so
# a wrong/stale resource is never shown; the copy still validates and keeps the door open.
SUPPORT_RESOURCE = os.environ.get("COACH_SUPPORT_RESOURCE", "").strip()


def _with_support(text: str) -> str:
    return f"{text} {SUPPORT_RESOURCE}".strip() if SUPPORT_RESOURCE else text


# Numberless, no appearance commentary, routes toward specialized support.
REDIRECTS = {
    "disordered_eating": _with_support(
        "I care about how you're doing, and this is something I'm not the right tool for. "
        "What you're describing deserves support from people trained specifically in this. "
        "If it would help, I can help you find eating-disorder support near you."
    ),
    "self_harm": _with_support(
        "I'm really glad you told me, and I want to make sure you're safe. I'm not able to be "
        "the right kind of support here, but you don't have to handle this alone — I can help "
        "you find people who can talk with you right now if you'd like."
    ),
    "extreme_deficit": (
        "I can't help with losing weight that fast — it isn't safe and tends to backfire. "
        "I can help you set a sustainable pace instead."
    ),
    "train_through_injury": (
        "I won't help you push through an injury. Let's let it be assessed and recover first; "
        "I can suggest ways to stay active that don't aggravate it."
    ),
}
GENERIC_SAFE = "I'm not able to help with that safely, but I'm happy to help another way."


def redirect_for(category: str | None) -> str:
    return REDIRECTS.get(category or "", GENERIC_SAFE)


# =============================================================================
# 4. Onboarding: conservative initial target (clamped by the same floors)
# =============================================================================
ACTIVITY_MULTIPLIER = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "active": 1.725}
KCAL_PER_KG = 7700  # approximate energy density of body mass change


def estimate_initial_target(profile: Profile, current_weight_kg: float):
    """Conservative starting target from a standard estimate (Mifflin-St Jeor) minus a
    modest deficit derived from the CAPPED goal rate, clamped to the absolute floors.
    Returns (daily_kcal, protein_g), or None when automated targets are disabled
    (eating-disorder history) — the coach then supports training only.
    Constants are clinician-calibration placeholders, same status as the floors."""
    if "eating_disorder_history" in profile.medical_flags:
        return None

    age = max(14, date.today().year - profile.birth_year)
    base = 10 * current_weight_kg + 6.25 * profile.height_cm - 5 * age
    sex_term = {"male": 5, "female": -161}.get(profile.sex.value, -78)
    tdee = (base + sex_term) * ACTIVITY_MULTIPLIER.get(profile.activity_level.value, 1.4)

    rate = min(max(profile.weekly_rate_kg, 0.0), MAX_SAFE_WEEKLY_RATE_KG)
    target = round(tdee - rate * KCAL_PER_KG / 7)

    floor = ABSOLUTE_KCAL_FLOOR.get(profile.sex.value, 1200)
    target = max(int(target), floor)

    protein = int(round(1.6 * profile.goal_weight_kg / 5) * 5)
    protein = max(MIN_PROTEIN_G, min(protein, MAX_PROTEIN_G))
    return target, protein


def estimate_maintenance(profile: Profile, current_weight_kg: float):
    """Estimated daily maintenance energy (Mifflin-St Jeor BMR x activity multiplier) — for the
    descriptive energy-balance view only, never a target. Returns None when automated calorie
    framing is disabled (eating-disorder history) so the UI hides the comparison entirely."""
    if "eating_disorder_history" in profile.medical_flags:
        return None
    age = max(14, date.today().year - profile.birth_year)
    base = 10 * current_weight_kg + 6.25 * profile.height_cm - 5 * age
    sex_term = {"male": 5, "female": -161}.get(profile.sex.value, -78)
    tdee = (base + sex_term) * ACTIVITY_MULTIPLIER.get(profile.activity_level.value, 1.4)
    return int(round(tdee))
