"""Ingest free-exercise-db (public domain / Unlicense) into the coach schema.

Produces two seed artifacts:
  * exercises.seed.json      — one row per exercise, mapped to our schema
  * variant_groups.seed.json — movement patterns, each grouping the SAME movement
                               done with different equipment, so the app can swap a
                               barbell version for a dumbbell or bodyweight version.

Grouping strategy (tuned for PRECISION over recall):
  The pattern key is the exercise's *base movement* — its name with equipment words
  removed — guarded by (category, force). Angle/stance/grip modifiers (incline, seated,
  close-grip) are kept, since they denote genuinely different exercises. A wrong swap is
  worse than a missing one, so ambiguous names stay in separate groups for trainer review.

Images are start/end photos, not animations; mirror them to your own storage for
production (the public-domain license allows it).
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

RAW_IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"

EQUIPMENT_MAP = {
    "body only": "none", None: "none",
    "dumbbell": "dumbbell", "barbell": "barbell", "e-z curl bar": "barbell",
    "machine": "machine", "cable": "cable", "kettlebells": "kettlebell",
    "bands": "band", "medicine ball": "other", "exercise ball": "other",
    "foam roll": "other", "other": "other",
}
TIER = {
    "none": "bodyweight", "band": "minimal", "dumbbell": "minimal",
    "kettlebell": "minimal", "other": "minimal",
    "barbell": "gym", "machine": "gym", "cable": "gym",
}

# Multi-word equipment phrases removed first, then single tokens.
_EQUIP_PHRASES = [
    "e-z curl bar", "ez curl bar", "smith machine", "medicine ball",
    "exercise ball", "stability ball", "foam roll", "resistance band",
]
_EQUIP_TOKENS = {
    "barbell", "dumbbell", "dumbbells", "cable", "cables", "machine",
    "kettlebell", "kettlebells", "band", "bands", "lever", "smith",
    "weighted", "ez", "e-z", "bodyweight",
}


def base_movement(name: str) -> str:
    """Equipment-stripped, normalized movement name. Keeps stance/angle/grip modifiers."""
    s = name.lower()
    for ph in _EQUIP_PHRASES:
        s = s.replace(ph, " ")
    s = re.sub(r"[^a-z0-9]+", " ", s)           # punctuation -> space
    tokens = [t for t in s.split() if t and t not in _EQUIP_TOKENS]
    cleaned = " ".join(tokens).strip()
    return cleaned or name.lower().strip()       # fallback if name was only equipment words


def map_exercise(src: dict) -> dict:
    equip = EQUIPMENT_MAP.get(src.get("equipment"), "other")
    return {
        "id": src["id"],
        "name": src["name"],
        "base_movement": base_movement(src["name"]),
        "force": src.get("force"),
        "mechanic": src.get("mechanic"),
        "category": src.get("category"),
        "difficulty": src.get("level"),
        "equipment": equip,
        "equipment_tier": TIER.get(equip, "minimal"),
        "primary_muscles": src.get("primaryMuscles", []),
        "secondary_muscles": src.get("secondaryMuscles", []),
        "cues": src.get("instructions", []),
        "image_urls": [RAW_IMAGE_BASE + p for p in src.get("images", [])],
    }


def pattern_key(ex: dict) -> tuple:
    # base movement guarded by category + force; modifiers intentionally retained.
    return (ex["category"], ex["force"], ex["base_movement"])


def build(src_path: str, out_dir: str) -> dict:
    raw = json.loads(Path(src_path).read_text())
    exercises = [map_exercise(e) for e in raw]

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for ex in exercises:
        groups[pattern_key(ex)].append(ex)

    variant_groups = []
    def _sort_key(kv):
        return tuple("" if x is None else x for x in kv[0])

    for i, (key, members) in enumerate(sorted(groups.items(), key=_sort_key)):
        by_equipment: dict[str, list[str]] = defaultdict(list)
        for m in members:
            by_equipment[m["equipment"]].append(m["id"])
        equip_set = set(by_equipment)
        variant_groups.append({
            "pattern_id": f"pat_{i:04d}",
            "base_movement": key[2],
            "category": key[0],
            "force": key[1],
            "equipment_available": sorted(equip_set),
            "has_bodyweight_option": "none" in equip_set,
            "by_equipment": {k: v for k, v in sorted(by_equipment.items())},
        })

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "exercises.seed.json").write_text(json.dumps(exercises, indent=2))
    (out / "variant_groups.seed.json").write_text(json.dumps(variant_groups, indent=2))

    multi = [g for g in variant_groups if len(g["equipment_available"]) > 1]
    swappable = [g for g in multi if g["has_bodyweight_option"]]
    return {
        "exercises": len(exercises),
        "patterns": len(variant_groups),
        "singleton_patterns": sum(1 for g in variant_groups
                                  if sum(len(v) for v in g["by_equipment"].values()) == 1),
        "patterns_with_multiple_equipment": len(multi),
        "patterns_with_bodyweight_swap": len(swappable),
    }


if __name__ == "__main__":
    print(json.dumps(build("exercises_raw.json", "/mnt/user-data/outputs/seed"), indent=2))
