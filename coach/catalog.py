"""Catalog variant index.

Backs `find_equipment_variant`: given an exercise and the equipment the user actually
has, return an alternative exercise that is the SAME movement done with available
equipment. Loaded from the seed produced by ingest.py; a concrete CoachRepo delegates
its `find_equipment_variant` here.

Selection heuristic when several variants are available: prefer the most "loadable"
option (barbell > dumbbell > ... > bodyweight), since a swap should preserve training
stimulus where possible rather than defaulting to bodyweight. Tunable below.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .models import VariantMatch

# Lower = preferred as a swap target.
_EQUIPMENT_PREFERENCE = {
    "barbell": 0, "dumbbell": 1, "kettlebell": 2, "machine": 3,
    "cable": 4, "band": 5, "other": 6, "none": 7,
}


class CatalogVariantIndex:
    def __init__(self, exercises: list[dict], variant_groups: list[dict]) -> None:
        self._name = {e["id"]: e["name"] for e in exercises}
        self._equipment = {e["id"]: e["equipment"] for e in exercises}
        self._images = {e["id"]: e.get("image_urls", []) for e in exercises}
        self._cues = {e["id"]: e.get("cues", []) for e in exercises}
        self._category = {e["id"]: e.get("category") for e in exercises}
        self._all = exercises
        self._group_for: dict[str, dict] = {}
        for g in variant_groups:
            for ids in g["by_equipment"].values():
                for ex_id in ids:
                    self._group_for[ex_id] = g

    @classmethod
    def from_seed(cls, seed_dir: str) -> "CatalogVariantIndex":
        d = Path(seed_dir)
        exercises = json.loads((d / "exercises.seed.json").read_text())
        groups = json.loads((d / "variant_groups.seed.json").read_text())
        return cls(exercises, groups)

    def name_of(self, exercise_id: str) -> str:
        return self._name.get(exercise_id, exercise_id)

    def equipment_of(self, exercise_id: str) -> str:
        return self._equipment.get(exercise_id, "other")

    def search(self, q: str | None = None, equipment: str | None = None, limit: int = 30) -> list[dict]:
        """Compact rows for the program-builder picker."""
        ql = q.lower().strip() if q else None
        out: list[dict] = []
        for e in self._all:
            if equipment and e["equipment"] != equipment:
                continue
            if ql and ql not in e["name"].lower() and ql not in e.get("base_movement", ""):
                continue
            out.append({
                "exercise_id": e["id"], "name": e["name"], "equipment": e["equipment"],
                "primary_muscles": e.get("primary_muscles", []),
                "category": e.get("category"),
                "image_urls": e.get("image_urls", []),
            })
            if len(out) >= limit:
                break
        return out

    def detail_of(self, exercise_id: str) -> dict:
        """Media + coaching cues for the UI."""
        return {
            "exercise_id": exercise_id,
            "name": self.name_of(exercise_id),
            "equipment": self.equipment_of(exercise_id),
            "image_urls": self._images.get(exercise_id, []),
            "cues": self._cues.get(exercise_id, []),
            "category": self._category.get(exercise_id),
        }

    def find_equipment_variant(
        self, exercise_id: str, available_equipment: set[str]
    ) -> Optional[VariantMatch]:
        group = self._group_for.get(exercise_id)
        if not group:
            return None
        candidates: list[tuple[str, str]] = []  # (equipment, exercise_id)
        for equipment, ids in group["by_equipment"].items():
            if equipment in available_equipment:
                candidates.extend((equipment, i) for i in ids if i != exercise_id)
        if not candidates:
            return None
        candidates.sort(key=lambda c: _EQUIPMENT_PREFERENCE.get(c[0], 99))
        equipment, variant_id = candidates[0]
        return VariantMatch(
            exercise_id=variant_id,
            name=self._name.get(variant_id, variant_id),
            equipment=equipment,
        )
