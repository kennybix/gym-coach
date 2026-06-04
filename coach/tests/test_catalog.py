"""Tests for the equipment-aware variant lookup."""
import pytest

from coach.catalog import CatalogVariantIndex

EXERCISES = [
    {"id": "bb_squat", "name": "Barbell Squat", "equipment": "barbell"},
    {"id": "db_squat", "name": "Dumbbell Squat", "equipment": "dumbbell"},
    {"id": "bw_squat", "name": "Bodyweight Squat", "equipment": "none"},
    {"id": "bench", "name": "Bench Press", "equipment": "barbell"},
]
GROUPS = [
    {"by_equipment": {"barbell": ["bb_squat"], "dumbbell": ["db_squat"], "none": ["bw_squat"]}},
    {"by_equipment": {"barbell": ["bench"]}},
]


@pytest.fixture
def idx():
    return CatalogVariantIndex(EXERCISES, GROUPS)


def test_swaps_to_bodyweight_when_only_none_available(idx):
    m = idx.find_equipment_variant("bb_squat", {"none"})
    assert m and m.exercise_id == "bw_squat" and m.equipment == "none"

def test_prefers_loaded_over_bodyweight(idx):
    m = idx.find_equipment_variant("bb_squat", {"dumbbell", "none"})
    assert m and m.exercise_id == "db_squat"  # dumbbell preferred over bodyweight

def test_no_variant_returns_none(idx):
    assert idx.find_equipment_variant("bench", {"none"}) is None

def test_unknown_exercise_returns_none(idx):
    assert idx.find_equipment_variant("nope", {"none"}) is None

def test_excludes_same_exercise(idx):
    assert idx.find_equipment_variant("bb_squat", {"barbell"}) is None
