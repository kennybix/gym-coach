"""Adaptive-target engine (coach/adaptive.py) — pure, deterministic, no DB/LLM.

Covers the safety-relevant behaviour: the data bar, the under-logging guard (thin logging
must never push a target DOWN), the floors, the step cap, the dead band, the cooldown, and
the ED-history kill switch.
"""
import datetime as dt

from coach import adaptive, safety
from coach.models import ActivityLevel, Profile, Sex

TODAY = dt.date(2026, 9, 12)


def _profile(rate=0.5, sex=Sex.male, flags=None):
    return Profile(user_id="u", sex=sex, birth_year=1990, height_cm=178,
                   activity_level=ActivityLevel.moderate, goal_weight_kg=80,
                   weekly_rate_kg=rate, medical_flags=flags or [])


def _weights(start_kg, kg_per_week, days=28, every=2):
    """Daily-averaged weigh-ins, every `every` days, on a straight line."""
    out = []
    for i in range(0, days, every):
        d = TODAY - dt.timedelta(days=days - 1 - i)
        out.append({"date": d.isoformat(), "weight_kg": round(start_kg + kg_per_week * i / 7, 2)})
    return out


def _intake(kcal, days=28, logged_every=1):
    out = []
    for i in range(0, days, logged_every):
        d = TODAY - dt.timedelta(days=days - 1 - i)
        out.append({"date": d.isoformat(), "kcal": kcal, "protein_g": 150})
    return out


def _run(profile=None, weights=None, intake=None, current=2300, since_days=30, latest=90.0):
    since = dt.datetime.combine(TODAY - dt.timedelta(days=since_days), dt.time(12), tzinfo=dt.timezone.utc)
    return adaptive.compute_estimate(
        profile or _profile(),
        weights if weights is not None else _weights(90, -0.5),
        intake if intake is not None else _intake(2000),
        current, since, latest, window_days=28, today=TODAY,
    )


def test_observed_maintenance_matches_energy_balance_arithmetic():
    est = _run()
    # 2000 kcal/day in, losing 0.5 kg/wk => burning 2000 + 0.5*7700/7 = 2550
    assert est.recommendation in ("adjust", "hold")
    assert abs(est.observed_maintenance_kcal - 2550) <= 5
    assert est.confidence == "high"
    assert est.days_logged == 28 and est.n_weighins == 14


def test_faster_than_goal_loss_raises_target_within_step_cap():
    # losing 1.2 kg/wk on 2000 kcal => maintenance ~3320; goal 0.5 kg/wk => target ~2770;
    # current 2300 => step-capped to +10% = 2530
    est = _run(weights=_weights(90, -1.2))
    assert est.recommendation == "adjust"
    assert est.suggested_target_kcal == 2525 or est.suggested_target_kcal == 2530
    assert est.change_kcal > 0
    assert est.suggested_target_kcal <= 2300 * 1.10 + adaptive.ROUND_TO


def test_slower_than_goal_loss_lowers_target_but_never_more_than_ten_percent():
    # holding weight on 2400 kcal => maintenance 2400; goal 0.5 => target 1850; current 2300
    est = _run(weights=_weights(90, 0.0), intake=_intake(2400))
    assert est.recommendation == "adjust"
    assert est.change_kcal < 0
    assert est.suggested_target_kcal >= 2300 * 0.90 - adaptive.ROUND_TO
    # and the review's own gate would accept it without confirmation (>85% of current)
    assert est.suggested_target_kcal >= 2300 * safety.CONFIRM_CUT_BAND


def test_small_difference_is_a_hold():
    # maintenance 2550 (as above), goal 0.5 => target ~2000; make current 2000 => hold
    est = _run(current=2000)
    assert est.recommendation == "hold"
    assert est.change_kcal == 0
    assert est.suggested_target_kcal == 2000


def test_insufficient_when_too_few_weighins_or_logged_days():
    est = _run(weights=_weights(90, -0.5)[:3])
    assert est.recommendation == "insufficient"
    assert est.suggested_target_kcal is None
    assert any("weigh-in" in n for n in est.needs)

    est = _run(intake=_intake(2000, logged_every=5))  # 6 logged days
    assert est.recommendation == "insufficient"
    assert any("food logged" in n for n in est.needs)
    # the formula anchor is still shown, at low confidence — never an observed number
    assert est.observed_maintenance_kcal is None
    assert est.estimated_maintenance_kcal == est.formula_maintenance_kcal
    assert est.confidence == "low"


def test_low_coverage_is_insufficient_even_with_ten_logged_days():
    # 10 logged days but a 27-day span => coverage ~0.36 < 0.5
    est = _run(intake=_intake(2000, days=28, logged_every=3)[:10])
    assert est.recommendation == "insufficient"
    assert any("most days" in n for n in est.needs)


def test_underlogging_guard_holds_instead_of_cutting():
    # "1200 kcal/day" while holding weight => observed 1200 << formula (~2700) => under-logged
    est = _run(weights=_weights(90, 0.0), intake=_intake(1200))
    assert est.recommendation == "underlogged"
    assert est.suggested_target_kcal is None  # nothing to apply, no cut
    assert est.estimated_maintenance_kcal == est.formula_maintenance_kcal


def test_cooldown_after_recent_target_change():
    est = _run(weights=_weights(90, 0.0), intake=_intake(2400), since_days=5)
    assert est.recommendation == "cooldown"
    assert est.suggested_target_kcal is not None  # computed, but not recommended yet


def test_floor_is_never_breached():
    # tiny, sedentary profile with an aggressive (capped) rate on a low intake
    p = Profile(user_id="u", sex=Sex.female, birth_year=1995, height_cm=155,
                activity_level=ActivityLevel.sedentary, goal_weight_kg=50, weekly_rate_kg=1.0)
    est = _run(profile=p, weights=_weights(55, -0.2), intake=_intake(1500), current=1300, latest=55.0)
    assert est.recommendation in ("hold", "adjust", "underlogged")
    if est.suggested_target_kcal is not None:
        assert est.suggested_target_kcal >= safety.ABSOLUTE_KCAL_FLOOR["female"]


def test_goal_rate_is_capped_in_the_deficit():
    fast = _run(profile=_profile(rate=3.0))
    capped = _run(profile=_profile(rate=safety.MAX_SAFE_WEEKLY_RATE_KG))
    assert fast.suggested_target_kcal == capped.suggested_target_kcal


def test_ed_history_disables_the_engine():
    est = _run(profile=_profile(flags=["eating_disorder_history"]))
    assert est.recommendation == "disabled"
    assert est.estimated_maintenance_kcal is None
    assert est.suggested_target_kcal is None


def test_no_current_target_reports_estimate_without_adjusting():
    est = _run(current=None)
    assert est.recommendation == "hold"
    assert est.change_kcal is None
    assert est.suggested_target_kcal is not None


def test_empty_logs_are_insufficient_not_an_error():
    est = _run(weights=[], intake=[], latest=None)
    assert est.recommendation == "insufficient"
    assert est.confidence == "none"
    assert est.needs
