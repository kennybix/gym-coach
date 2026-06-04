r"""Conversational coach graph (hardened).

    START -> hydrate -> screen_in -> agent --(read tools)--> tools -> agent ...
                                          \                       \--(staged change)--> safety
                                           \--(final reply)--> guard -> END
    safety --(reject)--> agent     safety --(approve)--> commit -> agent
    guard: screens the final reply; removes + replaces anything unsafe.

Invariants:
  * user_id comes from RunnableConfig (verified upstream by auth), never a tool arg.
  * The model PROPOSES; only `safety` + `commit` WRITE.
  * EVERY user turn is screened inbound; EVERY final reply is screened outbound.
  * Memory = checkpointer keyed by thread_id (continuity + resumable interrupts).
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, TypedDict

from langchain.chat_models import init_chat_model
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
)
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

from . import safety
from .models import Profile, ProposedProgramChange, ProposedTargetChange, Targets
from .repo import CoachRepo
from .tools import build_propose_tools, build_read_tools


class CoachState(TypedDict):
    user_id: str
    messages: Annotated[list[AnyMessage], add_messages]
    profile: Optional[dict]
    pending_mutation: Optional[dict]


SYSTEM_PROMPT = (
    "You are a weight-loss coach. Ground every claim about the user's progress in tool "
    "results — never invent numbers; call the read tools first. To change a calorie target "
    "or training program, call the relevant propose_* tool and do not describe the change as "
    "done until the system confirms it. If the user lacks equipment (e.g. traveling), call "
    "propose_equipment_swap with what they actually have so the program is rebuilt to fit. "
    "Refuse unsafe requests (extreme deficits, training "
    "through injury, anything resembling disordered eating) and offer a safe alternative. "
    "You are not a medical professional; say so when relevant."
)

# Placeholder copy — must be localized and clinically reviewed before launch.
# Deliberately free of numbers/appearance commentary; routes toward specialized support.
SAFE_REDIRECTS = {
    "disordered_eating": (
        "I care about how you're doing, and this is something I'm not the right tool for. "
        "What you're describing deserves support from people trained specifically in this. "
        "If it would help, I can point you toward eating-disorder support services in your area."
    ),
    "self_harm": (
        "I'm really glad you told me, and I want to make sure you're safe. I'm not able to be "
        "the right kind of support here, but you don't have to handle this alone — I can help "
        "you find people who can talk with you right now if you'd like."
    ),
    "extreme_deficit": (
        "I can't help with losing weight that fast — it isn't safe and tends to backfire. "
        "I can help you set a sustainable pace instead."
    ),
    "train_through_injury": (
        "I won't help you push through an injury. Let's let it be assessed and recover first; "
        "I can suggest ways to stay active that don't aggravate it."
    ),
    None: "I'm not able to help with that safely, but I'm happy to help another way.",
}


def build_coach_graph(repo: CoachRepo, checkpointer, model_id: str = "openai:gpt-4o", model=None):
    read_tools = build_read_tools(repo)
    propose_tools = build_propose_tools(repo)
    all_tools = read_tools + propose_tools
    base_model = model if model is not None else init_chat_model(model_id, temperature=0.2)
    model = base_model.bind_tools(all_tools)

    async def hydrate(state: CoachState, config: RunnableConfig) -> dict:
        uid = config["configurable"]["user_id"]
        if state.get("profile"):
            return {"user_id": uid}
        profile = await repo.get_profile(uid)
        return {"user_id": uid, "profile": profile.model_dump(mode="json")}

    async def screen_in(state: CoachState) -> dict:
        last_human = next(
            (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None
        )
        if not last_human:
            return {}
        res = safety.screen_user_message(_text(last_human.content))
        if not res.flagged:
            return {}
        return {
            "messages": [
                SystemMessage(
                    f"SAFETY POSTURE [{res.category}]: {res.posture} "
                    "Do not provide content that could enable harm."
                )
            ]
        }

    async def agent(state: CoachState) -> dict:
        msgs = [SystemMessage(SYSTEM_PROMPT)] + list(state["messages"])
        return {"messages": [await model.ainvoke(msgs)]}

    tool_node = ToolNode(all_tools)

    async def safety_gate(
        state: CoachState, config: RunnableConfig
    ) -> Command[Literal["agent", "commit"]]:
        uid = config["configurable"]["user_id"]
        profile = Profile(**state["profile"])
        pending = state["pending_mutation"]

        if pending["kind"] == "target_change":
            proposed = ProposedTargetChange(**pending)
            current = await repo.get_current_targets(uid)
            verdict = safety.check_target_change(
                profile, current.daily_kcal if current else None, proposed
            )
        else:
            verdict = safety.check_program_change(profile, ProposedProgramChange(**pending))

        if not verdict.approved:
            return Command(
                goto="agent",
                update={
                    "pending_mutation": None,
                    "messages": [
                        SystemMessage(
                            f"SAFETY: proposed change rejected — {verdict.reason} "
                            "Explain this plainly and offer a safe alternative."
                        )
                    ],
                },
            )

        if verdict.requires_user_confirmation:
            approved = interrupt(
                {"type": "confirm_change", "proposal": pending, "reason": verdict.reason}
            )
            if not approved:
                return Command(
                    goto="agent",
                    update={
                        "pending_mutation": None,
                        "messages": [
                            SystemMessage(
                                "SAFETY: user declined the change. Acknowledge and hold steady."
                            )
                        ],
                    },
                )

        return Command(goto="commit")

    async def commit(
        state: CoachState, config: RunnableConfig
    ) -> Command[Literal["agent"]]:
        uid = config["configurable"]["user_id"]
        pending = state["pending_mutation"]
        if pending["kind"] == "target_change":
            p = ProposedTargetChange(**pending)
            await repo.insert_target(
                uid,
                Targets(
                    daily_kcal=p.new_daily_kcal,
                    protein_g=p.new_protein_g,
                    source="coach_chat",
                    rationale=p.rationale,
                ),
            )
            note = "Committed the new daily target."
        else:
            p = ProposedProgramChange(**pending)
            await repo.apply_program_change(uid, p)
            note = f"Applied {len(p.edits)} program edit(s)."
        return Command(
            goto="agent",
            update={
                "pending_mutation": None,
                "messages": [
                    SystemMessage(
                        f"SAFETY: change approved and committed. {note} "
                        "Confirm to the user warmly and briefly."
                    )
                ],
            },
        )

    async def guard(state: CoachState) -> dict:
        last = state["messages"][-1]
        res = safety.screen_coach_reply(_text(last.content))
        if not res.flagged:
            return {}
        safe = SAFE_REDIRECTS.get(res.category, SAFE_REDIRECTS[None])
        # Remove the unsafe draft from history and replace it.
        return {"messages": [RemoveMessage(id=last.id), AIMessage(content=safe)]}

    def route_after_agent(state: CoachState) -> str:
        last = state["messages"][-1]
        return "tools" if getattr(last, "tool_calls", None) else "guard"

    def route_after_tools(state: CoachState) -> str:
        return "safety" if state.get("pending_mutation") else "agent"

    g = StateGraph(CoachState)
    g.add_node("hydrate", hydrate)
    g.add_node("screen_in", screen_in)
    g.add_node("agent", agent)
    g.add_node("tools", tool_node)
    g.add_node("safety", safety_gate)
    g.add_node("commit", commit)
    g.add_node("guard", guard)

    g.add_edge(START, "hydrate")
    g.add_edge("hydrate", "screen_in")
    g.add_edge("screen_in", "agent")
    g.add_conditional_edges("agent", route_after_agent, ["tools", "guard"])
    g.add_conditional_edges("tools", route_after_tools, ["safety", "agent"])
    g.add_edge("guard", END)
    return g.compile(checkpointer=checkpointer)


def _text(content) -> str:
    return content if isinstance(content, str) else str(content)
