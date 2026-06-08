# CLAUDE.md

Context for Claude Code working on this repo. Read this before making changes.

## What this is

A personal weight-loss training app: a workout/nutrition logger with an AI coach.
- **Backend** (`coach/`): Python — FastAPI service, a LangGraph coach agent, a
  deterministic safety layer, an asyncpg Postgres data layer, RAG + eval modules.
- **Frontend** (`web/`): Next.js 15 (App Router) PWA — installable, offline-capable,
  five screens (Today, Trends, Fuel, Coach, Setup) + a first-run onboarding wizard.
- Single-user by design (no multi-tenant billing/onboarding funnel), but auth is a
  real JWT boundary so it can open up later without a rewrite.

## Repo layout

```
coach/
  service.py        FastAPI app (lifespan wires repo + graphs; coach is OPTIONAL at startup)
  api.py            REST for the PWA: program/today, sessions, sets, weight, trends,
                    nutrition, onboarding, catalog, program
  graph.py          LangGraph coach: hydrate→screen→agent→tools→safety→commit→guard
  review.py         weekly-review graph (scheduled, structured output)
  safety.py         deterministic gate: target/program checks, goal-rate cap, content
                    screening, canonical crisis copy, initial-target estimator
  pg_repo.py        PostgresCoachRepo (implements repo.CoachRepo); all the SQL
  repo.py           CoachRepo protocol (the data boundary)
  catalog.py        in-memory exercise catalog + variant index (loaded from seed/)
  models.py         pydantic models (DB shapes, proposals, structured outputs)
  auth.py           JWT verification -> user_id (the security boundary)
  ingest.py         builds seed/ from free-exercise-db (public domain)
  rag/              corpus governance, pgvector store, cited-answer pipeline
  eval/             LLM-as-judge harness (grounding + usefulness)
  migrations/       001_core, 002_rls_supabase (Supabase-only), 003_targets_append_only,
                    004_pgvector
  tests/            pytest suite (safety, graph integration, catalog, rag, eval, store)
  smoke_test.py     repo validation vs live Postgres
  e2e_test.py       full vertical slice vs live PG (model scripted)
web/                Next.js PWA (components/, app/, lib/queue.ts = offline queue)
seed/               committed catalog seed (exercises + variant graph)
dev_up.sh           one-command local bring-up (Postgres + migrations)
mint_token.py       mint a bearer token for the Setup tab
requirements.txt    Python deps
```

## Setup & commands

```bash
# 1. Python deps
pip install -r requirements.txt

# 2. Postgres (14+ with pgvector). Local quickstart:
./dev_up.sh                         # starts PG, creates coachdb, applies migrations
# or apply manually: migrations 001, 003, 004 (skip 002 — it's Supabase-only)

# 3. Env (see .env.example) — at minimum:
export COACH_DB_URI=postgresql://coach:coach@localhost/coachdb
export COACH_SEED_DIR=$PWD/seed
export SUPABASE_JWT_SECRET=...      # any secret; used to sign/verify tokens
export GOOGLE_API_KEY=...           # enables the coach (omit -> coach returns 503, logging still works)

# 4. Run backend
uvicorn coach.service:app --port 8000

# 5. Run frontend
cd web && npm install && npm run dev      # http://localhost:3000

# 6. First token, then onboard in the UI
SUPABASE_JWT_SECRET=... python3 mint_token.py   # paste into Setup tab

# Tests
python -m pytest coach/tests -q                  # unit + integration (no DB/LLM needed)
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.smoke_test   # repo vs live PG
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.e2e_test     # full slice vs live PG
```

LLM is provider-agnostic via `init_chat_model`; default is `google_genai:gemini-3.5-flash`,
overridable per surface with `COACH_MODEL` / `COACH_RAG_MODEL` / `COACH_JUDGE_MODEL`.

## Architecture invariants — do not break

- **The LLM proposes; the system disposes.** The model never writes. It calls read
  tools and `propose_*` tools that only *stage* a typed change; only the `safety` and
  `commit` graph nodes touch the DB. Keep writes unreachable from the model.
- **`user_id` comes only from the verified JWT** (`auth.get_current_user_id`), never a
  request body or tool argument. Tools read it from `RunnableConfig`.
- **`targets` is append-only** (DB trigger, migration 003). Express a change by inserting
  a new row with a rationale; never UPDATE/DELETE history.
- **All offline-capable writes are idempotent** (client-generated UUIDs + `ON CONFLICT
  DO NOTHING`, or natural-key upsert for nutrition). The PWA replays a queue on
  reconnect — keep new write endpoints idempotent.
- **Cross-user/missing writes fail loudly** (raise), never silent no-ops.
- **The coach is optional at startup.** Missing LLM config must not take down the
  logging API — coach endpoints return 503; everything else keeps working.

## Safety & wellbeing invariants — do not weaken

This is a health-adjacent product. These are deliberate and must be preserved:
- **Calorie floors + single-step + goal-rate caps live in code** (`safety.py`), not the
  prompt. The onboarding starting target is computed conservatively and **clamped to the
  floors** before it is ever written; the goal rate is capped server-side.
- **Eating-disorder history disables automated calorie targets entirely.** Onboarding
  creates no target on that path; the coach refuses target changes. Do not add a code
  path that produces targets when this flag is set.
- **No UI ever suggests calorie/macro numbers.** Users log their own intake; targets come
  only from onboarding/coach. The Fuel screen leads with logging *consistency*, not the
  number, with no over/under verdicts. Keep this framing.
- **Content screening** (inbound + outbound) routes disordered-eating / self-harm /
  extreme-deficit / train-through-injury signals to support, never to optimized advice.
- **Crisis copy is single-sourced in `safety.py`** (`REDIRECTS` / `redirect_for`):
  numberless, no appearance commentary, region-appropriate. The support resource is
  operator-set via `COACH_SUPPORT_RESOURCE`. **Never hardcode a national helpline; do NOT
  use the NEDA Helpline (discontinued).** This prohibition is documented in the code —
  keep it.

## Current status

**Live and running** on this machine (`quantoptimus`) as systemd user services, served to
the user's Android phone over Tailscale at `https://gym-coach.taile8b1de.ts.net`
(tailnet-only HTTPS). Coach runs on **GPT-5.5 via the local CLI proxy**; embeddings via a
**LiteLLM→Ollama** gateway; RAG corpus populated (~257 chunks). Restart-resilient
(`Restart=always`, linger on). Full test suite green.

**Read [`docs/SYSTEM_OVERVIEW.md`](docs/SYSTEM_OVERVIEW.md) first** — it documents the whole
running system (architecture, ports, services, LLM wiring, phone access, operations) for the
next human/agent. Then [`deploy/README.md`](deploy/README.md) and
[`deploy/PHONE_ACCESS.md`](deploy/PHONE_ACCESS.md).

**Built since the original baseline:** food-database nutrition logging (Open Food Facts +
barcode + servings/recent), vitals (BP/HR), proactive coach insights, workout history,
program editor, in-place set/weight/nutrition editing, weekly-review scheduler (systemd
timer), nightly DB backup, data export, UI redesign, the Tailscale phone deploy.

**Open before a real launch:** a **clinician signs** [`deploy/SAFETY_REVIEW.md`](deploy/SAFETY_REVIEW.md);
always-on availability (app is up only while this machine is awake — the always-on path is
the droplet+domain version keeping the LLM here over Tailscale); device sync (Apple Health).

## Gotchas

- `web/` install can collide with a global `~/.npmrc` `prefix` setting; if `npm install`
  errors on prefix, that's why.
- Migration `001` is not idempotent (raw `CREATE TABLE`); `dev_up.sh` only applies
  migrations on a fresh DB.
- `seed/` is committed; regenerate with `python -c "from coach.ingest import build;
  build('exercises_raw.json','seed')"` if you re-ingest.
