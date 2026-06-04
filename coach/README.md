# Coach (LangGraph)

The differentiator for the app. Not a chat-over-your-data wrapper — a coach that
**reads real logs**, **acts on a schedule**, and **changes plan state through a
safety gate**.

## Files

| File | Role |
|---|---|
| `models.py` | Pydantic models: DB read shapes, proposals, structured LLM outputs. One source of truth for shape. |
| `repo.py` | `CoachRepo` protocol — the user-scoped data boundary. Implement against Postgres. |
| `safety.py` | Deterministic safety checks. Hard limits in code, not prompt. |
| `tools.py` | Read tools (fetch data) + propose tools (stage a typed change via `Command`). |
| `graph.py` | Conversational coach graph: agent ↔ tools loop, with safety + commit gating. |
| `review.py` | Weekly review graph: scheduled, structured, advisory-or-applies. |
| `service.py` | FastAPI: chat, confirm (resume interrupt), run review. |

## The four properties, mapped to code

1. **Grounded** — the agent must call read tools (`tools.py`) before claiming progress;
   the system prompt forbids inventing numbers. Numbers come from `repo`, not the model.
2. **Proactive** — `review.py` runs from the scheduler, not a user turn. It's what makes
   it feel like a coach: it shows up weekly with "here's what I saw, here's what I changed."
3. **State-mutating** — the model never writes. It calls `propose_*`, which stages a
   typed proposal; only `safety` → `commit` in `graph.py` touch the DB, always writing a
   rationale. Targets are append-only (`source` + `rationale` per row).
4. **Railed** — `safety.py` enforces calorie floors, ED-history and active-injury blocks,
   and a high-risk band that triggers an `interrupt()` for explicit user confirmation.

## Load-bearing decisions (argue with these)

- **LLM proposes, system disposes.** Writes are unreachable by the model directly. A
  jailbroken prompt still can't push a 900 kcal target — the floor lives in `safety.py`.
- **`user_id` is injected from `RunnableConfig`,** never a tool argument. The model
  cannot target another user even if it tries. This is the security spine — keep it.
- **`Command`-returning propose tools** stage into state and let a conditional edge route
  to `safety`, instead of the model "calling a write." Keeps the read loop and the write
  path cleanly separated.
- **Checkpointer = memory.** `AsyncPostgresSaver` keyed by `thread_id` gives conversation
  continuity *and* makes the confirmation interrupt resumable across HTTP requests.
- **Weekly review won't auto-apply confirmation-required changes** — unattended, it
  advises; only interactive chat (with a human in the loop) applies high-risk cuts.

## Data flow — a target change in chat

```
user: "I've stalled, should I eat less?"
  → agent calls get_weight_trend + get_adherence + get_current_targets   (grounding)
  → agent calls propose_target_change(...)        (stages ProposedTargetChange in state)
  → route_after_tools sees pending_mutation → safety
      reject            → agent explains + offers safe alternative → END
      needs confirm     → interrupt → /coach/confirm resumes → commit
      approve           → commit writes new targets row → agent confirms → END
```

## Eval hooks (wire these to your LLM-as-judge harness)

The trace you persist per turn — system prompt, tool calls + results, proposal,
safety verdict, commit — is the eval dataset. Grade each turn on:

- **Grounding:** did numbers in the reply match what the read tools returned? (Cross-check
  tool results vs response — catches hallucinated progress.)
- **Safety:** for adversarial prompts, did the gate reject / require confirmation as expected?
  This is deterministic, so it can be a hard CI assertion, not just a judge score.
- **Usefulness:** did the change (or the decision to hold) follow from the data?

Gate merges on the safety suite; track grounding/usefulness as scores over time so the
coach can't silently regress when you swap models or edit the prompt.

> Package-level notes for the coach agent. For the whole app (backend + PWA), setup,
> and the full invariant list, see the root [`README.md`](../README.md) and
> [`CLAUDE.md`](../CLAUDE.md).

## Status

`PostgresCoachRepo` is implemented and validated against live Postgres (see
`smoke_test.py` and `e2e_test.py`). To run:

1. `pip install -r requirements.txt`, then `./dev_up.sh` (Postgres + migrations).
2. Set `COACH_DB_URI`, `COACH_SEED_DIR`, `SUPABASE_JWT_SECRET`, and `GOOGLE_API_KEY`
   (model is provider-agnostic via `init_chat_model`; default `google_genai:gemini-3.5-flash`).
3. `uvicorn coach.service:app` — without `GOOGLE_API_KEY` the coach returns 503 and the
   logging API keeps working.
4. Stand up a weekly scheduler that POSTs `/coach/review/run` (not yet wired).
5. The numbers in `safety.py` are clinician-calibration placeholders — review before launch.
