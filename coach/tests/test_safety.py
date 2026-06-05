"""Tests for the deterministic safety layer.

These guard a health outcome and the logic is pure, so they run as a hard CI gate.
Numeric literals here are guardrail thresholds under test, not user-facing advice.
"""
import pytest

from coach.models import (
    ActivityLevel,
    Profile,
    ProgramExerciseEdit,
    ProposedProgramChange,
    ProposedTargetChange,
    Sex,
)
from coach import safety


def make_profile(sex=Sex.female, flags=None, rate=0.5) -> Profile:
    return Profile(
        user_id="u1", sex=sex, birth_year=1990, height_cm=170,
        activity_level=ActivityLevel.moderate, goal_weight_kg=70,
        weekly_rate_kg=rate, medical_flags=flags or [],
    )


def target(kcal, protein=120) -> ProposedTargetChange:
    return ProposedTargetChange(new_daily_kcal=kcal, new_protein_g=protein, rationale="test")


# --- mutation gating: target changes ----------------------------------------
def test_below_floor_is_rejected():
    v = safety.check_target_change(make_profile(Sex.male), 2200, target(1400))
    assert not v.approved

def test_floor_differs_by_sex():
    # 1300 is under the male floor but at/above the female floor
    assert not safety.check_target_change(make_profile(Sex.male), 2200, target(1300)).approved
    assert safety.check_target_change(make_profile(Sex.female), 1600, target(1300)).approved

def test_ed_history_blocks_any_target_change():
    v = safety.check_target_change(make_profile(flags=["eating_disorder_history"]), 1800, target(1700))
    assert not v.approved
    assert "support" in v.reason.lower()

def test_protein_out_of_range_rejected():
    assert not safety.check_target_change(make_profile(Sex.male), 2200, target(1800, protein=999)).approved

def test_too_aggressive_single_step_rejected():
    # current 2400 -> 1500 is below the 75% single-step band (1800), even though >= floor
    v = safety.check_target_change(make_profile(Sex.male), 2400, target(1500))
    assert not v.approved

def test_sizeable_cut_requires_confirmation():
    # current 2000 -> 1650 is between 75% (1500) and 85% (1700) -> approve but confirm
    v = safety.check_target_change(make_profile(Sex.female), 2000, target(1650))
    assert v.approved and v.requires_user_confirmation

def test_modest_safe_change_approved_no_confirm():
    v = safety.check_target_change(make_profile(Sex.female), 2000, target(1850))
    assert v.approved and not v.requires_user_confirmation

def test_no_current_target_still_respects_floor():
    assert safety.check_target_change(make_profile(Sex.female), None, target(1600)).approved
    assert not safety.check_target_change(make_profile(Sex.female), None, target(1100)).approved


# --- mutation gating: program + goal rate -----------------------------------
def test_active_injury_blocks_program_change():
    change = ProposedProgramChange(edits=[ProgramExerciseEdit(program_exercise_id="x", sets=5)], rationale="t")
    assert not safety.check_program_change(make_profile(flags=["injury_active"]), change).approved

def test_negative_program_values_rejected():
    change = ProposedProgramChange(edits=[ProgramExerciseEdit(program_exercise_id="x", reps=-3)], rationale="t")
    assert not safety.check_program_change(make_profile(), change).approved

def test_goal_rate_cap():
    assert not safety.validate_goal_rate(make_profile(rate=1.5)).approved
    assert safety.validate_goal_rate(make_profile(rate=0.5)).approved


# --- content screening: inbound ---------------------------------------------
def test_inbound_self_harm_flagged():
    r = safety.screen_user_message("sometimes i want to die")
    assert r.flagged and r.category == "self_harm"

def test_inbound_disordered_eating_flagged():
    r = safety.screen_user_message("how do i make myself throw up after eating")
    assert r.flagged and r.category == "disordered_eating"

def test_inbound_rapid_loss_flagged():
    r = safety.screen_user_message("i want to lose 15 lbs in a week")
    assert r.flagged and r.category == "extreme_deficit"

def test_inbound_train_through_injury_flagged():
    r = safety.screen_user_message("how do i work out with my injury anyway")
    assert r.flagged and r.category == "train_through_injury"

def test_inbound_normal_message_clean():
    assert not safety.screen_user_message("can you check how my training went this week?").flagged

def test_rapid_loss_threshold_not_overzealous():
    # a sane ~1 lb/week phrasing should not trip the rapid-loss regex
    assert not safety.screen_user_message("i'd like to lose 1 lbs in a week").flagged

# --- inbound: numeric extreme-deficit + rapid-loss intent (hardened) ----------
@pytest.mark.parametrize("msg", [
    "how do i survive on 500 calories a day?",
    "i want to eat only 800 calories a day",
    "should i restrict to 900 kcal daily",
    "thinking of a 1000 calorie a day diet",
    "is it ok to just eat 600 calories",
])
def test_inbound_low_calorie_intake_flagged(msg):
    r = safety.screen_user_message(msg)
    assert r.flagged and r.category == "extreme_deficit"

@pytest.mark.parametrize("msg", [
    "how do i lose weight as fast as possible",
    "what's the fastest way to lose weight",
    "i need to lose fat asap",
    "help me slim down as quickly as possible",
    "thinking about a crash diet",
])
def test_inbound_rapid_loss_intent_flagged(msg):
    r = safety.screen_user_message(msg)
    assert r.flagged and r.category == "extreme_deficit"

@pytest.mark.parametrize("msg", [
    "my maintenance is about 2400 calories a day, is that right?",
    "i ate 2000 calories today, how did i do?",
    "i want to build muscle as fast as possible",   # no weight-loss cue
    "i burned 500 calories on the treadmill",        # exercise expenditure, not a per-day intake target
])
def test_inbound_high_or_neutral_calorie_not_flagged(msg):
    assert not safety.screen_user_message(msg).flagged

def test_outbound_does_not_clobber_numeric_refusal():
    # The coach quotes the unsafe number while REFUSING it — outbound must not flag this,
    # or the safe refusal would be replaced by generic copy.
    reply = ("I can't set your target to 900 kcal/day — that's an extreme deficit. "
             "Let's set a sustainable pace instead.")
    assert not safety.screen_coach_reply(reply).flagged


# --- content screening: outbound --------------------------------------------
def test_outbound_catches_unsafe_reply():
    assert safety.screen_coach_reply("just skip all meals and you'll lose 10 pounds in a week").flagged

def test_outbound_passes_normal_reply():
    assert not safety.screen_coach_reply("Your trend is steady — let's keep the current plan and check back next week.").flagged
