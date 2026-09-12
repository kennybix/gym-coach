"""Weekly review x adaptive engine: target writes are system-owned.

No DB, no LLM: a FakeRepo feeds the graph a canned adaptive verdict and a scripted
structured-output model plays the assessor. Asserts that (1) an 'adjust' verdict is the
ONLY thing that writes a target, (2) the LLM's own proposal is recorded as advice but never
applied, (3) the engine's proposal still goes through the safety gate.
"""
import asyncio

from coach.adaptive import AdaptiveEstimate
from coach.models import (
    ActivityLevel, AdherenceSummary, NutritionSummary, Profile, ReviewAssessment,
    ReviewStatus, Sex, Targets, WeightTrend, ProposedTargetChange,
)
from coach.review import build_review_graph


class FakeRepo:
    def __init__(self, adaptive: AdaptiveEstimate, current=Targets(target_id="t0", daily_kcal=2300,
                                                                   protein_g=160, source="onboarding",
                                                                   rationale="base")):
        self._adaptive = adaptive
        self._current = current
        self.inserted = []
        self.reviews = []

    async def get_profile(self, uid):
        return Profile(user_id=uid, sex=Sex.male, birth_year=1990, height_cm=178,
                       activity_level=ActivityLevel.moderate, goal_weight_kg=80, weekly_rate_kg=0.5)

    async def get_weight_trend(self, uid, w):
        return WeightTrend(window_days=w, start_kg=90, latest_kg=89, smoothed_slope_kg_per_week=-0.5,
                           n_points=6, span_days=20, sufficient=True)

    async def get_adherence(self, uid, w):
        return AdherenceSummary(window_days=w, sessions_prescribed=3, sessions_completed=3,
                                sets_prescribed=30, sets_completed=28)

    async def get_nutrition_summary(self, uid, w):
        return NutritionSummary(window_days=w, days_logged=7, avg_kcal=2000, target_kcal=2300, avg_protein_g=150)

    async def get_vitals_summary(self, uid, w):
        return {"n_readings": 0}

    async def get_energy_balance(self, uid, w):
        return {"maintenance_kcal_per_day": None}

    async def get_recent_measurements(self, uid, w):
        return {"sites": {}}

    async def get_adaptive_estimate(self, uid, w=28):
        return self._adaptive

    async def get_current_targets(self, uid):
        return self._current

    async def insert_target(self, uid, t):
        self.inserted.append(t)
        self._current = t
        return t

    async def record_review(self, uid, status, summary, changes):
        self.reviews.append((status, summary, changes))
        return "r1"


class FakeAssessor:
    """Stands in for init_chat_model(...).with_structured_output(ReviewAssessment)."""
    def __init__(self, assessment: ReviewAssessment):
        self._a = assessment

    def with_structured_output(self, schema):
        return self

    async def ainvoke(self, prompt):
        return self._a


def _adjust(suggested=2450, current=2300):
    return AdaptiveEstimate(window_days=28, recommendation="adjust", days_logged=25, n_weighins=12,
                            span_days=27, log_coverage=0.9, avg_intake_kcal=2000,
                            weight_rate_kg_per_week=-0.9, formula_maintenance_kcal=2700,
                            observed_maintenance_kcal=2990, estimated_maintenance_kcal=2950,
                            confidence="high", current_target_kcal=current,
                            suggested_target_kcal=suggested, change_kcal=suggested - current,
                            reason="losing faster than goal; nudging the target up")


def _run(repo, assessment):
    graph = build_review_graph(repo, model=FakeAssessor(assessment))
    return asyncio.run(graph.ainvoke({"user_id": "u1", "window_days": 7, "committed_changes": {}}))


def test_adjust_verdict_writes_the_engine_number_not_the_llms():
    repo = FakeRepo(_adjust(suggested=2450))
    llm_idea = ProposedTargetChange(new_daily_kcal=1900, new_protein_g=160, rationale="llm wants a cut")
    out = _run(repo, ReviewAssessment(status=ReviewStatus.ahead, summary="Nice week.",
                                      proposed_target_change=llm_idea))
    assert len(repo.inserted) == 1
    t = repo.inserted[0]
    assert t.daily_kcal == 2450 and t.protein_g == 160 and t.source == "coach_review"
    assert t.rationale.startswith("Adaptive (energy-balance)")
    ch = out["committed_changes"]
    assert ch["target_change"]["new_daily_kcal"] == 2450
    assert ch["target_change"]["previous_daily_kcal"] == 2300
    assert ch["llm_advised_target"]["new_daily_kcal"] == 1900  # recorded, not applied


def test_hold_verdict_never_writes_even_if_llm_proposes():
    hold = _adjust().model_copy(update={"recommendation": "hold", "change_kcal": 0, "suggested_target_kcal": 2300})
    repo = FakeRepo(hold)
    out = _run(repo, ReviewAssessment(status=ReviewStatus.on_track, summary="Steady.",
                                      proposed_target_change=ProposedTargetChange(
                                          new_daily_kcal=2100, new_protein_g=160, rationale="stall")))
    assert repo.inserted == []
    assert "target_change" not in out["committed_changes"]
    assert out["committed_changes"]["llm_advised_target"]["new_daily_kcal"] == 2100
    assert out["committed_changes"]["adaptive"]["recommendation"] == "hold"


def test_insufficient_verdict_records_and_writes_nothing():
    est = AdaptiveEstimate(window_days=28, recommendation="insufficient", needs=["2 more weigh-ins"])
    repo = FakeRepo(est)
    out = _run(repo, ReviewAssessment(status=ReviewStatus.insufficient_data, summary="Log more."))
    assert repo.inserted == []
    assert out["committed_changes"]["adaptive"]["recommendation"] == "insufficient"


def test_engine_proposal_still_passes_the_safety_gate():
    # A (hypothetical) engine output below the floor must be blocked by safety, defense in depth.
    repo = FakeRepo(_adjust(suggested=1400))
    out = _run(repo, ReviewAssessment(status=ReviewStatus.behind, summary="Hmm."))
    assert repo.inserted == []
    assert "target_change_blocked" in out["committed_changes"]
