"""End-to-end vertical slice — everything real except the LLM.

Real LangGraph coach graph, real PostgresCoachRepo, live Postgres, and the
Postgres checkpointer for durable conversation memory. The model is scripted
because this environment has no API key; swapping in a real model is a one-line
change (drop the `model=` override and set COACH_MODEL + your key).

Proves, against the live database:
  1. SAFE PATH    — propose_target_change flows agent → tools → safety → commit and a
                    new `targets` row (source='coach_chat') lands in Postgres.
  2. UNSAFE PATH  — a below-floor proposal is rejected; no row is written.
  3. MEMORY       — a second turn on the same thread sees the first turn's history via
                    checkpoints stored IN Postgres (not process memory).

Run:
    COACH_DB_URI=postgresql://coach:coach@localhost/coachdb \
    COACH_SEED_DIR=/mnt/user-data/outputs/seed \
    python -m coach.e2e_test
"""
from __future__ import annotations

import asyncio
import os

import asyncpg
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from .catalog import CatalogVariantIndex
from .graph import build_coach_graph
from .pg_repo import PostgresCoachRepo
from .smoke_test import seed_fixture

DSN = os.environ["COACH_DB_URI"]
SEED_DIR = os.environ.get("COACH_SEED_DIR", "/mnt/user-data/outputs/seed")


class ScriptedModel:
    """One scripted tool call; a plain reply once the safety system has spoken."""

    def __init__(self, tool_name: str, tool_args: dict, final: str):
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


async def main() -> None:
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=5)
    user_id, _pe_id = await seed_fixture(pool)
    repo = PostgresCoachRepo(pool, CatalogVariantIndex.from_seed(SEED_DIR))

    async with AsyncPostgresSaver.from_conn_string(DSN) as saver:
        await saver.setup()  # checkpoint tables live in the same Postgres

        # ---- 1. SAFE PATH: modest target change commits to the real DB ------
        graph = build_coach_graph(
            repo, checkpointer=saver,
            model=ScriptedModel(
                "propose_target_change",
                {"new_daily_kcal": 2050, "new_protein_g": 160,
                 "rationale": "modest reduction; adherence is strong"},
                final="Done — your target was updated.",
            ),
        )
        cfg = {"configurable": {"thread_id": f"e2e-safe-{user_id[:8]}", "user_id": user_id}}
        out = await graph.ainvoke({"messages": [HumanMessage("I've stalled, adjust me a bit?")]}, cfg)
        assert "updated" in out["messages"][-1].content.lower()

        row = await pool.fetchrow(
            "select daily_kcal, source from targets where user_id=$1::uuid and source='coach_chat'",
            user_id,
        )
        assert row and row["daily_kcal"] == 2050, "committed target must be in Postgres"
        print(f"safe path: coach_chat target row landed in PG (daily_kcal={row['daily_kcal']})")

        # ---- 2. MEMORY: second turn on the same thread sees turn 1 ----------
        n_before = len(out["messages"])
        out2 = await graph.ainvoke({"messages": [HumanMessage("thanks!")]}, cfg)
        assert len(out2["messages"]) > n_before, "thread history must persist across invocations"
        ckpt = await pool.fetchval("select count(*) from checkpoints")
        assert ckpt and ckpt > 0, "checkpoints must be stored in Postgres"
        print(f"memory: thread grew {n_before} -> {len(out2['messages'])} msgs; "
              f"{ckpt} checkpoints in PG")

        # ---- 3. UNSAFE PATH: below-floor proposal writes nothing ------------
        graph_bad = build_coach_graph(
            repo, checkpointer=saver,
            model=ScriptedModel(
                "propose_target_change",
                {"new_daily_kcal": 1100, "new_protein_g": 160, "rationale": "aggressive"},
                final="I can't set it that low; here's a sustainable option instead.",
            ),
        )
        cfg_bad = {"configurable": {"thread_id": f"e2e-unsafe-{user_id[:8]}", "user_id": user_id}}
        out_bad = await graph_bad.ainvoke({"messages": [HumanMessage("cut me way down")]}, cfg_bad)
        assert any("rejected" in str(getattr(m, "content", "")).lower() for m in out_bad["messages"])

        n_bad = await pool.fetchval(
            "select count(*) from targets where user_id=$1::uuid and daily_kcal=1100", user_id
        )
        assert n_bad == 0, "rejected proposal must write nothing"
        print("unsafe path: rejected by the gate; no row written")

    await pool.close()
    print("\nE2E VERTICAL SLICE PASSED (real graph + real repo + live PG; model scripted)")


if __name__ == "__main__":
    asyncio.run(main())
