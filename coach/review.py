"""Weekly review graph — the proactive heart of the product.

Runs from the scheduler, not from a user message. It pulls the week, assesses against
the goal, optionally proposes a change, safety-gates it, commits, and records a
`coach_review` row the user sees on next open. Linear and deterministic in shape;
the only LLM call is the structured `assess` step.

    START -> gather -> assess -> commit_and_record -> END
"""
from __future__ import annotations

from typing import Optional, TypedDict

from langchain.chat_models import init_chat_model
from langgraph.graph import END, START, StateGraph

from . import safety
from .models import Profile, ReviewAssessment, Targets
from .repo import CoachRepo


class ReviewState(TypedDict):
    user_id: str
    window_days: int
    profile: Optional[dict]
    trend: Optional[dict]
    adherence: Optional[dict]
    nutrition: Optional[dict]
    vitals: Optional[dict]
    assessment: Optional[dict]
    committed_changes: dict


REVIEW_PROMPT = (
    "You are reviewing one week for a weight-loss client. Given their goal, weight "
    "trend, training adherence, nutrition, and any logged vitals (blood pressure / heart "
    "rate), classify the status and write a short, honest, encouraging summary (2-4 "
    "sentences). If vitals were logged, you may note a meaningful trend (e.g. a falling "
    "resting heart rate is a real win); if a reading is in a clearly concerning range, "
    "gently suggest a professional check rather than interpreting it. Propose a calorie-"
    "target change ONLY if the data clearly supports it — e.g. a genuine stall alongside "
    "good adherence. Be conservative: small adjustments beat big ones, and no change is a "
    "valid outcome."
)


def build_review_graph(repo: CoachRepo, model_id: str = "google_genai:gemini-3.5-flash"):
    assessor = init_chat_model(model_id, temperature=0.2).with_structured_output(
        ReviewAssessment
    )

    async def gather(state: ReviewState) -> dict:
        uid, w = state["user_id"], state["window_days"]
        profile = await repo.get_profile(uid)
        return {
            "profile": profile.model_dump(),
            "trend": (await repo.get_weight_trend(uid, w)).model_dump(),
            "adherence": (await repo.get_adherence(uid, w)).model_dump(),
            "nutrition": (await repo.get_nutrition_summary(uid, w)).model_dump(),
            "vitals": await repo.get_vitals_summary(uid, w),
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
        }
        result: ReviewAssessment = await assessor.ainvoke(
            REVIEW_PROMPT + "\n\nDATA:\n" + str(payload)
        )
        return {"assessment": result.model_dump()}

    async def commit_and_record(state: ReviewState) -> dict:
        uid = state["user_id"]
        a = ReviewAssessment(**state["assessment"])
        changes: dict = {}

        if a.proposed_target_change:
            profile = Profile(**state["profile"])
            current = await repo.get_current_targets(uid)
            verdict = safety.check_target_change(
                profile,
                current.daily_kcal if current else None,
                a.proposed_target_change,
            )
            # The unattended weekly review never force-applies a change that would
            # require explicit user confirmation — it advises instead.
            if verdict.approved and not verdict.requires_user_confirmation:
                p = a.proposed_target_change
                await repo.insert_target(
                    uid,
                    Targets(
                        daily_kcal=p.new_daily_kcal,
                        protein_g=p.new_protein_g,
                        source="coach_review",
                        rationale=p.rationale,
                    ),
                )
                changes["target_change"] = p.model_dump()
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
