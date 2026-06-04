"""End-to-end graph integration tests.

No database and no real LLM: a FakeRepo implements CoachRepo in memory, and a scripted
FakeChatModel drives the agent. This exercises the actual graph topology — hydrate →
screen → agent → tools → safety → commit → guard — and asserts that writes happen only
when the safety gate approves.
"""
import asyncio

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from coach.graph import build_coach_graph
from coach.models import (
    ActivityLevel,
    ProgramExerciseRef,
    Profile,
    Sex,
    Targets,
    VariantMatch,
)


class FakeRepo:
    def __init__(self, medical_flags=None):
        self.medical_flags = medical_flags or []
        self.inserted_targets = []
        self.program_changes = []
        self.reviews = []
        self._current = Targets(target_id="t0", daily_kcal=2200, protein_g=160,
                                source="onboarding", rationale="base")

    async def get_profile(self, user_id):
        return Profile(user_id=user_id, sex=Sex.male, birth_year=1990, height_cm=180,
                       activity_level=ActivityLevel.moderate, goal_weight_kg=80,
                       weekly_rate_kg=0.5, medical_flags=self.medical_flags)

    async def get_current_targets(self, user_id):
        return self._current

    async def insert_target(self, user_id, targets):
        t = targets.model_copy(update={"target_id": "t_new"})
        self.inserted_targets.append(t)
        self._current = t
        return t

    async def get_program_exercises(self, user_id):
        return [ProgramExerciseRef(program_exercise_id="pe1", exercise_id="Barbell_Squat",
                                   name="Barbell Squat", equipment="barbell")]

    async def find_equipment_variant(self, exercise_id, available):
        if "none" in available:
            return VariantMatch(exercise_id="Bodyweight_Squat", name="Bodyweight Squat",
                                equipment="none")
        return None

    async def apply_program_change(self, user_id, change):
        self.program_changes.append(change)

    async def record_review(self, user_id, status, summary, changes):
        self.reviews.append((status, summary, changes))
        return "r1"

    # unused by these scenarios
    async def get_weight_trend(self, *a): ...
    async def get_adherence(self, *a): ...
    async def get_nutrition_summary(self, *a): ...


class FakeChatModel:
    """Returns a scripted tool call on the first pass; a plain reply once the safety
    system has spoken (its notes contain 'SAFETY:')."""
    def __init__(self, tool_name, tool_args, final="Done."):
        self._tool_name, self._tool_args, self._final = tool_name, tool_args, final

    def bind_tools(self, tools, **kw):
        return self

    async def ainvoke(self, messages, *a, **kw):
        joined = " ".join(str(getattr(m, "content", "")) for m in messages)
        if "SAFETY:" in joined:
            return AIMessage(content=self._final)
        return AIMessage(content="", tool_calls=[{
            "name": self._tool_name, "args": self._tool_args,
            "id": "call_1", "type": "tool_call"}])


def _run(repo, fake_model, user_msg):
    graph = build_coach_graph(repo, checkpointer=MemorySaver(), model=fake_model)
    cfg = {"configurable": {"thread_id": "t1", "user_id": "u1"}}
    return asyncio.run(graph.ainvoke({"messages": [HumanMessage(user_msg)]}, config=cfg))


def test_safe_target_change_commits():
    repo = FakeRepo()
    model = FakeChatModel("propose_target_change",
                          {"new_daily_kcal": 2100, "new_protein_g": 160,
                           "rationale": "small cut, good adherence"},
                          final="Updated your target.")
    out = _run(repo, model, "I've stalled a bit, can we adjust?")
    assert len(repo.inserted_targets) == 1
    assert repo.inserted_targets[0].daily_kcal == 2100
    assert out["pending_mutation"] is None
    assert "Updated" in out["messages"][-1].content


def test_unsafe_target_change_blocked():
    repo = FakeRepo()
    model = FakeChatModel("propose_target_change",
                          {"new_daily_kcal": 1200, "new_protein_g": 160,
                           "rationale": "aggressive"},
                          final="That isn't safe; here's a sustainable option instead.")
    out = _run(repo, model, "cut me way down")
    assert repo.inserted_targets == []  # the gate blocked the write
    assert any("rejected" in str(getattr(m, "content", "")).lower()
               for m in out["messages"])


def test_equipment_swap_commits():
    repo = FakeRepo()
    model = FakeChatModel("propose_equipment_swap",
                          {"available_equipment": ["none"], "rationale": "traveling"},
                          final="Swapped your session to bodyweight moves.")
    out = _run(repo, model, "I'm traveling with no gear")
    assert len(repo.program_changes) == 1
    edit = repo.program_changes[0].edits[0]
    assert edit.swap_to_exercise_id == "Bodyweight_Squat"
    assert out["pending_mutation"] is None


def test_injury_blocks_swap():
    repo = FakeRepo(medical_flags=["injury_active"])
    model = FakeChatModel("propose_equipment_swap",
                          {"available_equipment": ["none"], "rationale": "traveling"},
                          final="Let's not change the program while you're injured.")
    out = _run(repo, model, "swap my workout")
    assert repo.program_changes == []  # injury flag blocks program edits
