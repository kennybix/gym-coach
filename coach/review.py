"""Weekly review graph — the proactive heart of the product.

Runs from the scheduler, not from a user message. It pulls the week, assesses against
the goal, applies the adaptive-target engine's verdict, safety-gates it, commits, and
records a `coach_review` row the user sees on next open. Linear and deterministic in
shape; the only LLM call is the structured `assess` step.

    START -> gather -> assess -> commit_and_record -> END

Calorie-target changes in the unattended review are SYSTEM-OWNED: only the deterministic
adaptive engine (coach/adaptive.py) can produce one, and it still passes through
safety.check_target_change. The LLM's own `proposed_target_change` is recorded as advice
(`llm_advised_target`) for transparency but never written — the model explains, the
system disposes. (The chat coach keeps the interactive propose→confirm path.)
"""
from __future__ import annotations

from typing import Optional, TypedDict

from langchain.chat_models import init_chat_model
from langgraph.graph import END, START, StateGraph

from . import adaptive, safety
from .models import Profile, ProposedTargetChange, ReviewAssessment, Targets
from .repo import CoachRepo


class ReviewState(TypedDict):
    user_id: str
    window_days: int
    profile: Optional[dict]
    trend: Optional[dict]
    adherence: Optional[dict]
    nutrition: Optional[dict]
    vitals: Optional[dict]
    energy: Optional[dict]
    measurements: Optional[dict]
    adaptive: Optional[dict]
    assessment: Optional[dict]
    committed_changes: dict


REVIEW_PROMPT = (
    "You are reviewing one week for a weight-loss client. Given their goal, weight "
    "trend, training adherence, nutrition, and any logged vitals (blood pressure / heart "
    "rate), classify the status and write a short, honest, encouraging summary (2-4 "
    "sentences). If vitals were logged, you may note a meaningful trend (e.g. a falling "
    "resting heart rate is a real win); if a reading is in a clearly concerning range, "
    "gently suggest a professional check rather than interpreting it. If energy.maintenance_"
    "kcal_per_day is present, you MAY note the rough intake-vs-maintenance picture "
    "descriptively (estimates; the weight trend is the real signal) — never as a target or a "
    "verdict, and skip it entirely when it is null. If measurements.sites has data, you MAY "
    "cite a circumference change factually (e.g. 'waist down 2 cm') as an objective fat-loss "
    "signal — never as appearance commentary; especially call out RECOMPOSITION when the waist "
    "or belly is falling while body weight holds steady (fat down, muscle kept — a real win the "
    "scale hides). "
    "CALORIE TARGETS: the system's adaptive engine decides them, not you (see `adaptive`). "
    "If adaptive.recommendation is 'adjust', the system WILL move the target to "
    "adaptive.suggested_target_kcal — mention this change in one plain sentence using its "
    "`reason`, framed as a routine calibration, not a verdict on the week. If it is 'hold', "
    "'cooldown' or 'underlogged', say the target stays put (and, for 'underlogged', gently "
    "encourage logging every meal). If it is 'insufficient', use `needs` to say exactly what "
    "to log so the estimate can firm up. Never quote a maintenance or target number that is "
    "not in `adaptive`. You may still set proposed_target_change as ADVICE, but it is not "
    "applied. Be conservative: no change is a valid outcome."
)


def build_review_graph(repo: CoachRepo, model_id: str = "google_genai:gemini-3.5-flash", model=None):
    base = model if model is not None else init_chat_model(model_id, temperature=0.2)
    assessor = base.with_structured_output(ReviewAssessment)

    async def gather(state: ReviewState) -> dict:
        uid, w = state["user_id"], state["window_days"]
        profile = await repo.get_profile(uid)
        return {
            "profile": profile.model_dump(),
            "trend": (await repo.get_weight_trend(uid, w)).model_dump(),
            "adherence": (await repo.get_adherence(uid, w)).model_dump(),
            "nutrition": (await repo.get_nutrition_summary(uid, w)).model_dump(),
            "vitals": await repo.get_vitals_summary(uid, w),
            "energy": await repo.get_energy_balance(uid, w),
            # wider window: measurements are logged infrequently, so 90d gives a real change
            "measurements": await repo.get_recent_measurements(uid, max(w, 90)),
            # the adaptive engine always looks at 28 days — a week is too noisy for a slope
            "adaptive": (await repo.get_adaptive_estimate(uid, 28)).model_dump(),
        }

    async def assess(state: ReviewState) -> dict:
        payload = {
            "goal": {
                "goal_weight_kg": state["profile"]["goal_weight_kg"],
                "weekly_rate_kg": state["profile"]["weekly_rate_kg"],
            },
            "trend": state["trend"],
            "adherence": state["adherence"],
            "nutrition": state["nutrition"],
            "vitals": state.get("vitals"),
            "energy": state.get("energy"),
            "measurements": state.get("measurements"),
            "adaptive": state.get("adaptive"),
        }
        result: ReviewAssessment = await assessor.ainvoke(
            REVIEW_PROMPT + "\n\nDATA:\n" + str(payload)
        )
        return {"assessment": result.model_dump()}

    async def commit_and_record(state: ReviewState) -> dict:
        uid = state["user_id"]
        a = ReviewAssessment(**state["assessment"])
        changes: dict = {}

        # The LLM's own target idea is advice only — recorded, never written.
        if a.proposed_target_change:
            changes["llm_advised_target"] = a.proposed_target_change.model_dump()

        est = adaptive.AdaptiveEstimate(**state["adaptive"]) if state.get("adaptive") else None
        changes["adaptive"] = {
            "recommendation": est.recommendation if est else None,
            "estimated_maintenance_kcal": est.estimated_maintenance_kcal if est else None,
            "confidence": est.confidence if est else None,
        }

        if est and est.recommendation == "adjust" and est.suggested_target_kcal:
            profile = Profile(**state["profile"])
            current = await repo.get_current_targets(uid)
            proposal = ProposedTargetChange(
                new_daily_kcal=est.suggested_target_kcal,
                new_protein_g=current.protein_g if current else 0,
                rationale=adaptive.rationale_for(est),
            )
            verdict = safety.check_target_change(
                profile, current.daily_kcal if current else None, proposal,
            )
            # The unattended weekly review never force-applies a change that would
            # require explicit user confirmation — it advises instead.
            if verdict.approved and not verdict.requires_user_confirmation:
                await repo.insert_target(
                    uid,
                    Targets(
                        daily_kcal=proposal.new_daily_kcal,
                        protein_g=proposal.new_protein_g,
                        source="coach_review",
                        rationale=proposal.rationale,
                    ),
                )
                changes["target_change"] = {
                    **proposal.model_dump(),
                    "previous_daily_kcal": current.daily_kcal if current else None,
                }
            else:
                changes["target_change_blocked"] = verdict.reason

        review_id = await repo.record_review(uid, a.status.value, a.summary, changes)
        return {"committed_changes": {"review_id": review_id, **changes}}

    g = StateGraph(ReviewState)
    g.add_node("gather", gather)
    g.add_node("assess", assess)
    g.add_node("commit_and_record", commit_and_record)
    g.add_edge(START, "gather")
    g.add_edge("gather", "assess")
    g.add_edge("assess", "commit_and_record")
    g.add_edge("commit_and_record", END)
    return g.compile()
