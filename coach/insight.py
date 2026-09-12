"""Proactive coach insight — a short, grounded "here's what I noticed" line for Home.

A one-shot LLM call over a compact data snapshot (no tools, no writes, no DB mutation).
Cheap and fast; the service caches the result per user with a short TTL so it isn't
regenerated on every Today open. Grounding is enforced the usual way: the model is handed
the real numbers and told never to invent.
"""
from __future__ import annotations

import json

from .repo import CoachRepo

INSIGHT_PROMPT = (
    "You are the user's training coach. From this data snapshot, write ONE short, specific, "
    "encouraging observation about what stands out RIGHT NOW — a weight trend, a logging "
    "streak, training adherence, a vitals trend, or a body-measurement change. If measurements "
    "show a waist/belly drop while body weight holds steady, that's recomposition (fat down, "
    "muscle kept) — a great thing to surface, stated factually, never as appearance commentary. "
    "ONE sentence, at most 22 words — it renders as a single line on the home screen. Ground "
    "every number in the data; never invent. If the data is too thin to say anything real, "
    "give a gentle nudge to log consistently. Not medical advice; if a vitals reading is "
    "clearly concerning, suggest a professional check rather than interpreting it. No "
    "greeting and no preamble — just the observation."
)


# Optional lens for the note — lets the Today card rotate emphasis on each refresh.
_FOCUS_HINT = {
    "weight": "Focus on the body-weight trend this time.",
    "training": "Focus on training adherence and consistency this time.",
    "nutrition": "Focus on nutrition logging and intake vs target this time.",
    "vitals": "Focus on the blood-pressure / heart-rate trend this time.",
    "measurements": "Focus on body-measurement changes (waist/belly) and recomposition this time.",
}


async def generate_insight(repo: CoachRepo, model, user_id: str, focus: str = "auto") -> str | None:
    """Return a 1-2 sentence grounded note, or None if the user isn't onboarded yet.
    `focus` optionally biases the note toward one area (weight/training/nutrition/vitals)."""
    try:
        await repo.get_profile(user_id)
    except LookupError:
        return None

    snapshot = {
        "weight_trend_28d": (await repo.get_weight_trend(user_id, 28)).model_dump(),
        "adherence_14d": (await repo.get_adherence(user_id, 14)).model_dump(),
        "nutrition_14d": (await repo.get_nutrition_summary(user_id, 14)).model_dump(),
        "vitals_30d": await repo.get_vitals_summary(user_id, 30),
        "measurements_90d": await repo.get_recent_measurements(user_id, 90),
        # adaptive engine: only the parts useful for a nudge (what's missing / that it's firmed up)
        "adaptive_28d": {
            k: v for k, v in (await repo.get_adaptive_estimate(user_id, 28)).model_dump().items()
            if k in ("recommendation", "needs", "days_logged", "n_weighins", "span_days", "confidence")
        },
        "current_targets": (
            t.model_dump() if (t := await repo.get_current_targets(user_id)) else None
        ),
    }
    prompt = INSIGHT_PROMPT
    hint = _FOCUS_HINT.get(focus)
    if hint:
        prompt += " " + hint
    resp = await model.ainvoke(prompt + "\n\nDATA:\n" + json.dumps(snapshot, default=str))
    text = (resp.content or "").strip()
    return text or None
