"""Natural-language workout logging.

Turn a free-text description of a workout the user JUST DID ("two 20 lb dumbbells, 3 sets of
10 alternate curls") into structured, confirmable entries. The LLM extracts; the catalog
matches the movement; the user confirms before anything is written — same "LLM proposes,
system disposes" spine as the coach. No DB write happens here; the client logs the confirmed
entries through the normal idempotent /api/sets/sync path so they feed history, PRs, and the coach.
"""
from __future__ import annotations

import json
import re

EQUIP = {"barbell", "dumbbell", "kettlebell", "machine", "cable", "band", "other", "none"}

PARSE_PROMPT = (
    "You convert a free-text description of a workout the user JUST DID into structured entries. "
    'Return ONLY a JSON object {"entries": [ ... ]}, one entry per distinct exercise. No prose.\n\n'
    "Each entry has:\n"
    '- "raw": the part of the text it came from\n'
    '- "kind": "strength" or "cardio"\n'
    '- "exercise_query": a short canonical exercise name to look up (e.g. "dumbbell biceps curl", '
    '"treadmill running"). No brands or slang.\n'
    '- "equipment": one of barbell|dumbbell|kettlebell|machine|cable|band|other|none, or null\n'
    '- strength only: "sets" (int), "reps" (int per set), "weight_kg" (number; the weight PER '
    'hand/dumbbell as stated), "rpe" (number 6-10 or null)\n'
    '- cardio only: "duration_s" (int seconds), "distance_m" (int meters or null)\n'
    '- "confidence": "high"|"medium"|"low"\n'
    '- "note": one short clause about any assumption/estimate you made, else ""\n\n'
    "Rules:\n"
    "- Convert ALL units to kg, seconds, meters. Pounds->kg x0.4536, miles->x1609, minutes->x60.\n"
    '- "two 20 lb dumbbells, 3 sets of 10" -> sets=3, reps=10, weight_kg~=9.1 (per dumbbell).\n'
    "- If a treadmill/run gives speed + time, ESTIMATE distance = speed x time; assume mph unless "
    "km/h is clear, and say so in note. If distance is genuinely unclear (e.g. \"3 trips\"), set "
    "distance_m to null and note it.\n"
    "- Sports & free activities without gym equipment (tennis, basketball, swimming, yoga, hiking, "
    "soccer, jump rope, walking, dancing) -> kind \"cardio\", exercise_query = the activity name in "
    "Title Case (e.g. \"Tennis\"), duration_s from the time, distance_m null unless a distance is "
    "given. It's expected that these won't match the gym catalog.\n"
    "- Never invent exercises that weren't described. If unsure of the exact movement, give your "
    'best exercise_query and confidence "low".\n'
)


def _custom_exercise(name: str, kind: str) -> dict:
    """A non-catalog activity (e.g. tennis) logged as itself. exercise_id IS the display name
    (set_logs has no name column; name_of() falls back to the id), so it renders cleanly."""
    nm = (name or "Activity").strip().title()[:60] or "Activity"
    return {"exercise_id": nm, "name": nm, "equipment": "none",
            "category": "cardio" if kind == "cardio" else None, "image_urls": []}


def _extract_json(text: str) -> dict:
    """Pull the JSON object out of the model output, tolerating code fences / stray prose."""
    if not text:
        return {}
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


def _num(v):
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _int(v):
    n = _num(v)
    return int(round(n)) if n is not None else None


async def parse_workout(text: str, model, repo) -> dict:
    """Free text -> structured entries, each matched to catalog exercises (best + alternatives)."""
    resp = await model.ainvoke(PARSE_PROMPT + "\n\nDESCRIPTION:\n" + (text or "").strip())
    content = getattr(resp, "content", resp)
    data = _extract_json(content if isinstance(content, str) else str(content))
    raw_entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(raw_entries, list):
        return {"entries": []}

    out = []
    for e in raw_entries[:20]:
        if not isinstance(e, dict):
            continue
        kind = "cardio" if e.get("kind") == "cardio" else "strength"
        equip = e.get("equipment") if e.get("equipment") in EQUIP else None
        candidates = repo.match_catalog(e.get("exercise_query"), equipment=equip, limit=5)
        custom = not candidates
        entry = {
            "raw": (e.get("raw") or "")[:200],
            "kind": kind,
            "exercise_query": e.get("exercise_query") or "",
            # Fall back to logging the activity as itself (tennis, yoga, …) when nothing matches.
            "exercise": candidates[0] if candidates else _custom_exercise(e.get("exercise_query"), kind),
            "custom": custom,
            "candidates": candidates,
            "confidence": e.get("confidence") if e.get("confidence") in {"high", "medium", "low"} else "medium",
            "note": (e.get("note") or "")[:200],
            "rpe": _num(e.get("rpe")),
        }
        if kind == "strength":
            entry["sets"] = max(1, _int(e.get("sets")) or 1)
            entry["reps"] = max(1, _int(e.get("reps")) or 1)
            entry["weight_kg"] = _num(e.get("weight_kg"))
        else:
            entry["duration_s"] = _int(e.get("duration_s"))
            entry["distance_m"] = _int(e.get("distance_m"))
        out.append(entry)
    return {"entries": out}
