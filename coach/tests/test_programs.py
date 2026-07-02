"""Program library: exercise resolution, curated templates, and AI-design JSON parsing.
Pure logic — no DB/LLM (a fake catalog + fake model stand in)."""
import asyncio

from coach import programs


class FakeCatalog:
    """Matches 'squat' only; everything else is unknown (-> custom id)."""
    def match(self, q, equipment=None, limit=5):
        return [{"exercise_id": "Barbell_Squat", "name": "Barbell Squat"}] if "squat" in (q or "").lower() else []

    def name_of(self, exid):
        return exid.replace("_", " ")


class FakeModel:
    def __init__(self, content):
        self._content = content

    async def ainvoke(self, _msg):
        class R:
            content = self._content
        return R()


def test_resolve_prefers_explicit_id():
    out = programs.resolve_exercises([{"exercise_id": "Kegel_Hold_Slow", "sets": 3, "reps": 10}], FakeCatalog())
    assert out[0]["exercise_id"] == "Kegel_Hold_Slow" and out[0]["sets"] == 3 and out[0]["reps"] == 10


def test_resolve_matches_by_name():
    out = programs.resolve_exercises([{"name": "back squat", "sets": 5, "reps": 5}], FakeCatalog())
    assert out[0]["exercise_id"] == "Barbell_Squat"


def test_resolve_mints_custom_id_when_unmatched():
    out = programs.resolve_exercises([{"name": "Pelvic Thing", "sets": 2, "reps": 8}], FakeCatalog())
    assert out[0]["exercise_id"] == "Pelvic_Thing"  # custom, non-catalog


def test_pelvic_floor_template_present_with_note():
    t = next((x for x in programs.TEMPLATES if x["key"] == "pelvic_floor"), None)
    assert t is not None and t.get("note")  # safety/referral note attached
    prog = programs.template_program("pelvic_floor", FakeCatalog())
    assert prog["note"] and len(prog["exercises"]) >= 5


def test_design_program_parses_and_resolves():
    model = FakeModel('{"name":"Strong","goal":"g","sessions_per_week":4,'
                      '"exercises":[{"name":"squat","sets":3,"reps":8}],"note":"n"}')
    out = asyncio.run(programs.design_program("get strong", "male", FakeCatalog(), model))
    assert out["name"] == "Strong" and out["sessions_per_week"] == 4
    assert out["exercises"][0]["exercise_id"] == "Barbell_Squat"


def test_design_program_clamps_sessions_per_week():
    out = asyncio.run(programs.design_program("x", "male", FakeCatalog(), FakeModel('{"sessions_per_week":99,"exercises":[]}')))
    assert 1 <= out["sessions_per_week"] <= 7
