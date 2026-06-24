"""Program library: curated templates + AI generation from a goal.

Both paths produce the same shape — {name, goal, sessions_per_week, exercises:[{exercise_id,
name, sets, reps}]} — which the user reviews and the repo installs via add_program (added to the
library, NOT replacing the active program). Exercise names are resolved to catalog ids where
possible; anything not in the catalog (e.g. kegels) becomes a custom exercise (its own id/name,
no media). "LLM proposes, user confirms, system writes" — no DB write here.
"""
from __future__ import annotations

import re

from .parse import _extract_json, _int

# ----------------------------- curated templates -----------------------------
TEMPLATES = [
    {"key": "full_body", "name": "Full Body 3×", "goal": "General strength", "sessions_per_week": 3,
     "exercises": [{"name": "squat", "sets": 3, "reps": 8}, {"name": "bench press", "sets": 3, "reps": 8},
                   {"name": "bent over row", "sets": 3, "reps": 8}, {"name": "overhead press", "sets": 3, "reps": 10},
                   {"name": "romanian deadlift", "sets": 3, "reps": 10}, {"name": "plank", "sets": 3, "reps": 1}]},
    {"key": "upper_lower", "name": "Upper / Lower", "goal": "Strength + size", "sessions_per_week": 4,
     "exercises": [{"name": "bench press", "sets": 4, "reps": 8}, {"name": "lat pulldown", "sets": 4, "reps": 10},
                   {"name": "overhead press", "sets": 3, "reps": 10}, {"name": "squat", "sets": 4, "reps": 8},
                   {"name": "romanian deadlift", "sets": 3, "reps": 10}, {"name": "leg press", "sets": 3, "reps": 12}]},
    {"key": "ppl", "name": "Push / Pull / Legs", "goal": "Hypertrophy", "sessions_per_week": 6,
     "exercises": [{"name": "bench press", "sets": 4, "reps": 8}, {"name": "overhead press", "sets": 3, "reps": 10},
                   {"name": "triceps pushdown", "sets": 3, "reps": 12}, {"name": "pullups", "sets": 3, "reps": 8},
                   {"name": "bent over row", "sets": 4, "reps": 10}, {"name": "bicep curl", "sets": 3, "reps": 12},
                   {"name": "squat", "sets": 4, "reps": 8}, {"name": "leg curl", "sets": 3, "reps": 12},
                   {"name": "calf raise", "sets": 4, "reps": 15}]},
    {"key": "core", "name": "Core & Trunk", "goal": "Core strength", "sessions_per_week": 3,
     "exercises": [{"name": "plank", "sets": 3, "reps": 1}, {"name": "crunch", "sets": 3, "reps": 15},
                   {"name": "leg raise", "sets": 3, "reps": 12}, {"name": "russian twist", "sets": 3, "reps": 20},
                   {"name": "back extension", "sets": 3, "reps": 12}]},
    {"key": "mobility", "name": "Daily Mobility", "goal": "Flexibility", "sessions_per_week": 7,
     "exercises": [{"name": "cat stretch", "sets": 2, "reps": 10}, {"name": "calf stretch", "sets": 2, "reps": 1},
                   {"name": "chest stretch", "sets": 2, "reps": 1}, {"name": "lower back stretch", "sets": 2, "reps": 1}]},
    {"key": "pelvic_floor", "name": "Pelvic Floor & Stamina", "goal": "Pelvic floor · men's stamina & control",
     "sessions_per_week": 7,
     "note": "General fitness for pelvic-floor strength, control and stamina — best done daily, and "
             "balance the squeezes with the reverse/relaxation work. This is not medical treatment: "
             "for erectile dysfunction, pain, or persistent concerns see a doctor or a pelvic-floor "
             "physiotherapist.",
     "exercises": [{"exercise_id": "Kegel_Hold_Slow", "sets": 3, "reps": 10},
                   {"exercise_id": "Kegel_Quick_Flicks", "sets": 3, "reps": 15},
                   {"exercise_id": "Reverse_Kegel", "sets": 2, "reps": 8},
                   {"exercise_id": "Elevator_Kegel", "sets": 2, "reps": 6},
                   {"exercise_id": "Bridge_Pelvic_Lift", "sets": 3, "reps": 12},
                   {"exercise_id": "Diaphragmatic_Breathing", "sets": 1, "reps": 10}]},
]


def _custom_id(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip()).strip("_") or "Exercise"


def resolve_exercises(items: list[dict], catalog) -> list[dict]:
    """Map each item to a catalog exercise_id. An explicit exercise_id wins (curated templates);
    otherwise match the free-text name to the catalog, or mint a custom id."""
    out = []
    for it in items:
        sets, reps = _int(it.get("sets")) or 3, _int(it.get("reps")) or 10
        exid = str(it.get("exercise_id") or "").strip()
        if exid:
            out.append({"exercise_id": exid, "name": catalog.name_of(exid), "sets": sets, "reps": reps})
            continue
        q = str(it.get("name") or it.get("query") or "").strip()
        if not q:
            continue
        m = catalog.match(q, limit=1)
        exid, nm = (m[0]["exercise_id"], m[0]["name"]) if m else (_custom_id(q), q)
        out.append({"exercise_id": exid, "name": nm, "sets": sets, "reps": reps})
    return out


def template_program(key: str, catalog) -> dict | None:
    t = next((x for x in TEMPLATES if x["key"] == key), None)
    if not t:
        return None
    return {"name": t["name"], "goal": t["goal"], "sessions_per_week": t["sessions_per_week"],
            "exercises": resolve_exercises(t["exercises"], catalog), "note": t.get("note")}


# ----------------------------- AI generation ---------------------------------
DESIGN_PROMPT = (
    "You are a fitness coach designing a simple, safe WEEKLY program for the user's goal. Return "
    'ONLY JSON: {"name": short program name, "goal": short goal label, "sessions_per_week": 1-7, '
    '"exercises": [{"name": common exercise name, "sets": int, "reps": int}], "note": one short '
    "sentence}. Use 4-8 exercises with widely-known names. For hold/time or cardio moves, still "
    "give sensible sets and reps (reps = seconds or count). Keep total volume MODERATE and "
    "beginner-safe. If the goal is health/medical (e.g. pelvic-floor/kegels, rehab, post-surgery), "
    "give only general fitness guidance and set note to advise seeing a relevant specialist — never "
    "clinical/medical instructions.\n"
    "For pelvic-floor / sexual-stamina / lasting-longer / kegel goals (men), USE THESE EXACT exercise "
    "names so they resolve to the right moves, and always include BOTH squeezes and relaxation work: "
    "'Kegel Hold (Slow)', 'Kegel Quick Flicks (Fast)', 'Reverse Kegel (Relax & Lengthen)', "
    "'Elevator Kegels', 'Glute Bridge + Pelvic Floor Lift', 'Diaphragmatic Breathing'."
)


async def design_program(goal: str, profile_summary: str, catalog, model) -> dict:
    resp = await model.ainvoke(DESIGN_PROMPT + f"\n\nUser goal: {goal}\nUser: {profile_summary}")
    content = getattr(resp, "content", resp)
    data = _extract_json(content if isinstance(content, str) else str(content))
    if not isinstance(data, dict):
        data = {}
    spw = _int(data.get("sessions_per_week")) or 3
    return {
        "name": str(data.get("name") or goal[:40].title() or "New program")[:60],
        "goal": str(data.get("goal") or goal)[:80],
        "sessions_per_week": max(1, min(7, spw)),
        "exercises": resolve_exercises(data.get("exercises") or [], catalog),
        "note": (str(data.get("note"))[:200] if data.get("note") else None),
    }
