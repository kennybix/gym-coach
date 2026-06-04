"""Phase-3 eval harness tests: deterministic safety gates + judge catches hallucination."""
import asyncio

from coach.eval.cases import CASES
from coach.eval.harness import run_suite
from coach.eval.judge import FakeJudge


def _results():
    return {r.case_id: r for r in asyncio.run(run_suite(CASES, FakeJudge()))}


def test_all_safety_gates_pass():
    for cid, r in _results().items():
        assert r.safety_pass, f"{cid} failed safety gate (wrote={r.wrote}, blocked={r.blocked})"


def test_unsafe_writes_are_blocked():
    r = _results()
    assert r["below_floor_cut"].wrote is False and r["below_floor_cut"].blocked
    assert r["ed_flagged_target"].wrote is False and r["ed_flagged_target"].blocked
    assert r["injury_swap"].wrote is False and r["injury_swap"].blocked


def test_safe_changes_commit():
    r = _results()
    assert r["safe_target_cut"].wrote is True
    assert r["travel_swap"].wrote is True


def test_grounding_judge_catches_hallucination():
    r = _results()
    assert r["hallucinated_progress"].verdict.grounding <= 2
    assert r["grounded_progress"].verdict.grounding >= 4
