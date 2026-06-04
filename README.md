# Gym Coach

A personal weight-loss training app: workout + nutrition logging with an AI coach that
reads your actual logs, adapts your plan through a safety gate, and reviews each week.

- **Backend** (`coach/`) — FastAPI + a LangGraph coach agent + a deterministic safety
  layer + Postgres (asyncpg). RAG and eval modules included.
- **Frontend** (`web/`) — Next.js 15 PWA, installable and offline-capable: Today, Trends,
  Fuel, Coach, Setup, plus a first-run onboarding wizard.

> **Working in Claude Code?** Start with [`CLAUDE.md`](./CLAUDE.md) — it has the structure,
> commands, and the architectural + safety invariants to preserve.

## Quickstart (local)

```bash
pip install -r requirements.txt
./dev_up.sh                                   # Postgres + migrations (needs PG 14+ w/ pgvector)

cp .env.example .env                          # then fill it in
export $(grep -v '^#' .env | xargs)           # or use your own env loader

uvicorn coach.service:app --port 8000         # backend
cd web && npm install && npm run dev          # frontend -> http://localhost:3000

SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET python3 mint_token.py   # token for the Setup tab
```

Then open the app, go to **Setup**, paste the API URL + token, and complete onboarding.
The coach activates once `GOOGLE_API_KEY` is set; without it, logging works and coach
endpoints return 503.

## Status

Built and validated to the limit of a headless environment: data layer (smoke + e2e
against live Postgres), full test suite green (`pytest coach/tests`), every REST endpoint
live-tested, both onboarding paths, all screens build and serve.

**Verify on your machine first:** (1) one real Gemini round-trip through the Coach to
confirm tool-calling drives the safety gate; (2) a phone/browser pass on the PWA.

**Remaining:** deployment hardening (CORS, HTTPS, backups), the weekly-review scheduler
(cron → `/coach/review/run`), and ingesting a vetted RAG corpus (pipeline exists, corpus
is empty). See `CLAUDE.md` for detail.

## Tests

```bash
python -m pytest coach/tests -q                                  # no DB/LLM needed
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.smoke_test   # repo vs live PG
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.e2e_test     # full slice vs live PG
```

## Credits / licensing

Exercise catalog derived from [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
(public domain / Unlicense), ingested via `coach/ingest.py`. This is a personal project; review
licensing before any public distribution.
