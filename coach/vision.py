"""Vision: estimate nutrition from a photo of food.

A photo -> the multimodal model identifies each item, estimates portion grams + macros ->
structured, confirmable entries. Same "LLM proposes, user confirms, system writes" spine as
the text describe-flow: no DB write here; the client logs the confirmed items via /api/foods/log.
Estimates are labelled as such.
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage

from .parse import _extract_json, _int, _num

FOOD_PHOTO_PROMPT = (
    "You estimate nutrition from a photo of food. Identify each distinct food or drink item "
    'visible and estimate its portion and nutrition. Return ONLY JSON {"items": [ ... ]}, one '
    "object per item, no prose.\n"
    "Each item has:\n"
    '- "name": a short food name\n'
    '- "grams": estimated portion weight in grams (integer), judged from visual cues like plate, '
    "bowl or utensil size\n"
    '- "kcal": integer calories for that portion\n'
    '- "protein_g", "carbs_g", "fat_g", "fiber_g": grams (numbers) for that portion\n'
    '- "confidence": "high" | "medium" | "low"\n'
    "Be realistic and lower the confidence when the portion or contents are unclear. If the image "
    'contains no food, return {"items": []}. Everything is an estimate.'
)


async def parse_food_photo(image_data_url: str, note: str | None, model) -> dict:
    text = FOOD_PHOTO_PROMPT
    if note:
        text += f"\n\nThe user added a note about the meal: {note.strip()[:300]}"
    msg = HumanMessage(content=[
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ])
    resp = await model.ainvoke([msg])
    content = getattr(resp, "content", resp)
    data = _extract_json(content if isinstance(content, str) else str(content))
    raw = data.get("items") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return {"items": []}

    out = []
    for it in raw[:20]:
        if not isinstance(it, dict) or not it.get("name"):
            continue
        out.append({
            "name": str(it["name"])[:80],
            "grams": _int(it.get("grams")),
            "kcal": _int(it.get("kcal")) or 0,
            "protein_g": _num(it.get("protein_g")),
            "carbs_g": _num(it.get("carbs_g")),
            "fat_g": _num(it.get("fat_g")),
            "fiber_g": _num(it.get("fiber_g")),
            "confidence": it.get("confidence") if it.get("confidence") in {"high", "medium", "low"} else "medium",
        })
    return {"items": out}
