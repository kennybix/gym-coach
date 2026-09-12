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

import os

from typing import Annotated, Literal, Optional, TypedDict

from langchain.chat_models import init_chat_model
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
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
    "results — never invent numbers; call the read tools first. When you cite the weight "
    "trend, respect its `sufficient` flag: if it is false (too few weigh-ins over too short a "
    "span), do NOT state a kg/week rate — say the trend isn't reliable yet and encourage a few "
    "more weigh-ins. Calorie targets are owned by the system's adaptive energy-balance engine: "
    "before discussing maintenance calories or any calorie-target change, call "
    "get_adaptive_target_estimate. If its recommendation is 'adjust', propose exactly its "
    "suggested_target_kcal via propose_target_change (keep protein unchanged) and explain its "
    "reason; if it is 'hold', 'cooldown', 'underlogged' or 'insufficient', do NOT propose a "
    "calorie change — explain why and, when it lists `needs`, tell the user exactly what to log. "
    "Never state a maintenance or target number the tool did not return. To change a calorie target "
    "or training program, call the relevant propose_* tool and do not describe the change as "
    "done until the system confirms it. If the user lacks equipment (e.g. traveling), call "
    "propose_equipment_swap with what they actually have so the program is rebuilt to fit. "
    "The user may also log blood pressure and heart rate; call get_recent_vitals to reference "
    "those trends (e.g. a falling resting HR is a real training win worth noting). Comment on "
    "vitals naturally, but if a reading is in a genuinely concerning range (e.g. blood pressure "
    "around 180/120 or higher, or a very high/low resting heart rate), gently suggest they get "
    "it checked by a healthcare professional rather than interpreting it yourself. "
    "They may also log body measurements (waist, belly, etc.); call get_recent_measurements to "
    "reference circumference changes as objective fat-loss signals — factually, never as "
    "appearance commentary. A falling waist/belly while body weight holds is recomposition worth "
    "highlighting, since the scale hides it. "
    "When asked how to do an exercise or whether their form is right (including kegels / "
    "pelvic-floor work), call explain_exercise and ground your technique guidance in the returned "
    "cues rather than inventing form. For pelvic-floor / sexual-stamina topics, stay supportive and "
    "factual, remind them to balance squeezes with relaxation, and suggest a doctor or pelvic-floor "
    "physiotherapist for erectile dysfunction or persistent medical concerns. "
    "When asked whether they've kept up with an exercise or routine (e.g. 'have I been doing my "
    "pelvic-floor work?'), call get_exercise_consistency and cite the days logged + last date. "
    "VOICE: write like a coach talking to one person — short paragraphs of plain prose, warm "
    "and direct, two to five sentences for most replies. Use a bulleted list only for a genuine "
    "list (a plan, steps, a set of options), never to dump tool fields; do not write lines like "
    "'Recommendation: insufficient data' or 'Confidence: low' — fold the meaning into a sentence. "
    "Refuse unsafe requests (extreme deficits, training "
    "through injury, anything resembling disordered eating) and offer a safe alternative. "
    "You are not a medical professional; say so when relevant."
)


def _evidence_for(name: str, d: dict) -> Optional[dict]:
    """Turn one read-tool result into a compact {label, detail} the UI can show, so the user
    sees the real figures the coach looked at. None = nothing worth showing."""
    g = d.get
    if name == "get_weight_trend":
        n = g("n_points") or 0
        if not n:
            return None
        s, l, span = g("start_kg"), g("latest_kg"), g("span_days") or 0
        detail = f"{s:g}→{l:g} kg" if s is not None and l is not None else "logged"
        rate = g("smoothed_slope_kg_per_week")
        detail += f" · ~{abs(rate):.1f} kg/wk over {span}d" if g("sufficient") and rate is not None \
            else f" · {n} logs/{span}d (building)"
        return {"label": "Weight", "detail": detail}
    if name == "get_adherence":
        return {"label": "Training",
                "detail": f"{g('sessions_completed', 0)}/{g('sessions_prescribed', 0)} sessions · "
                          f"{g('sets_completed', 0)}/{g('sets_prescribed', 0)} sets"}
    if name == "get_nutrition_summary":
        if not (g("days_logged") or 0):
            return None
        parts = []
        if g("avg_kcal") is not None:
            parts.append(f"{round(g('avg_kcal'))} kcal" + (f"/{g('target_kcal')}" if g("target_kcal") else ""))
        if g("avg_protein_g") is not None:
            parts.append(f"{round(g('avg_protein_g'))} g protein")
        return {"label": "Nutrition", "detail": " · ".join(parts + [f"{g('days_logged')}d logged"])}
    if name == "get_current_targets":
        if not g("daily_kcal"):
            return None
        return {"label": "Targets", "detail": f"{g('daily_kcal')} kcal · {g('protein_g')} g protein"}
    if name == "get_recent_vitals":
        if not (g("n_readings") or 0):
            return None
        latest, parts = g("latest") or {}, []
        if isinstance(latest, dict):
            if latest.get("systolic") and latest.get("diastolic"):
                parts.append(f"{latest['systolic']}/{latest['diastolic']}")
            if latest.get("heart_rate"):
                parts.append(f"{latest['heart_rate']} bpm")
        return {"label": "Vitals", "detail": " · ".join(parts) or f"{g('n_readings')} readings"}
    if name == "get_activity_energy":
        if not g("total_est_kcal"):
            return None
        return {"label": "Activity", "detail": f"~{g('total_est_kcal')} kcal burned · {g('window_days')}d (est.)"}
    if name == "get_recent_measurements":
        sites = g("sites") or {}
        parts = []
        for k in ("waist_cm", "belly_cm", "body_fat_pct"):
            s = sites.get(k)
            if isinstance(s, dict) and s.get("latest") is not None:
                nm, unit = ("body fat", "%") if k == "body_fat_pct" else (k[:-3], " cm")
                ch = s.get("change") or 0
                chs = f" ({'+' if ch > 0 else ''}{ch})" if ch else ""
                parts.append(f"{nm} {s['latest']}{unit}{chs}")
        return {"label": "Measurements", "detail": " · ".join(parts)} if parts else None
    if name == "explain_exercise":
        return {"label": "Technique", "detail": g("name")} if g("found") else None
    if name == "get_adaptive_target_estimate":
        rec = g("recommendation")
        if rec == "disabled":
            return None
        if rec == "insufficient":
            return {"label": "Energy balance",
                    "detail": f"building · {g('days_logged', 0)}d food · {g('n_weighins', 0)} weigh-ins/{g('span_days', 0)}d"}
        est = g("estimated_maintenance_kcal")
        parts = [f"~{est} kcal/day maintenance ({g('confidence')})"] if est else []
        parts.append(f"{g('days_logged', 0)}d food · {g('n_weighins', 0)} weigh-ins/{g('span_days', 0)}d")
        if rec == "adjust" and g("suggested_target_kcal"):
            parts.append(f"target {g('current_target_kcal')}→{g('suggested_target_kcal')}")
        elif rec in ("hold", "cooldown", "underlogged"):
            parts.append(rec)
        return {"label": "Energy balance", "detail": " · ".join(parts)}
    if name == "get_exercise_consistency":
        if not g("found"):
            return None
        return {"label": "Consistency", "detail": f"{g('days_logged')}d logged · {g('total_sets')} sets · {g('window_days')}d window"}
    return None


def summarize_evidence(messages: list) -> list[dict]:
    """The real data the coach pulled on the latest turn (tool results since the last user
    message), as {label, detail} chips. Truthful by construction — it's what the tools returned."""
    import json
    last_human = max((i for i, m in enumerate(messages) if isinstance(m, HumanMessage)), default=-1)
    by_label: dict[str, dict] = {}
    for m in messages[last_human + 1:]:
        if not isinstance(m, ToolMessage):
            continue
        try:
            data = json.loads(m.content) if isinstance(m.content, str) else None
        except Exception:
            data = None
        if isinstance(data, dict):
            ev = _evidence_for(getattr(m, "name", "") or "", data)
            if ev:
                by_label[ev["label"]] = ev  # last call of a tool wins
    return list(by_label.values())


async def proposal_diff(repo: CoachRepo, uid: str, pending: dict) -> list[dict]:
    """Old→new rows for a staged change, so the confirm card shows exactly what will change."""
    kind = pending.get("kind")
    if kind == "target_change":
        cur = await repo.get_current_targets(uid)
        return [
            {"label": "Daily calories", "from": f"{cur.daily_kcal} kcal" if cur else "—",
             "to": f"{pending.get('new_daily_kcal')} kcal"},
            {"label": "Protein", "from": f"{cur.protein_g} g" if cur else "—",
             "to": f"{pending.get('new_protein_g')} g"},
        ]
    if kind == "program_change":
        by_id = {s["program_exercise_id"]: s for s in await repo.get_program_slots(uid)}

        def fmt(sets, reps, load):
            if not sets and not reps:
                return "—"
            return f"{sets}×{reps}" + (f" @ {load:g} kg" if load else "")

        out = []
        for e in pending.get("edits", []):
            cur = by_id.get(e.get("program_exercise_id"), {})
            name = cur.get("name", "Exercise")
            frm = fmt(cur.get("sets"), cur.get("reps"), cur.get("load_kg"))
            if e.get("swap_to_exercise_id"):
                out.append({"label": name, "from": frm, "to": "swap to fit equipment"})
            else:
                to = fmt(e.get("sets") or cur.get("sets"), e.get("reps") or cur.get("reps"),
                         e.get("load_kg") if e.get("load_kg") is not None else cur.get("load_kg"))
                out.append({"label": name, "from": frm, "to": to})
        return out
    return []


def build_coach_graph(repo: CoachRepo, checkpointer, model_id: str = "google_genai:gemini-3.5-flash", model=None):
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
            diff = await proposal_diff(repo, uid, pending)
            approved = interrupt(
                {"type": "confirm_change", "proposal": pending, "reason": verdict.reason, "diff": diff}
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
        safe = safety.redirect_for(res.category)
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
