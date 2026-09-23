# CLAUDE.md

Context for Claude Code working on this repo. Read this before making changes.

## What this is

A personal weight-loss training app: a workout/nutrition logger with an AI coach.
- **Backend** (`coach/`): Python — FastAPI service, a LangGraph coach agent, a deterministic
  safety layer, a deterministic adaptive-target engine, an asyncpg Postgres data layer,
  RAG + eval modules.
- **Frontend** (`web/`): Next.js 15 (App Router) PWA — installable, offline-capable, five tabs
  (Home, Train, Food, Progress, Coach) plus Setup and a first-run wizard, five user-selectable
  looks, and a Capacitor Android shell for Health Connect.
- Single-user by design (no multi-tenant billing/onboarding funnel), but auth is a real JWT
  boundary so it can open up later without a rewrite.

## Repo layout

```
coach/
  service.py        FastAPI app (lifespan wires repo + graphs; coach is OPTIONAL at startup)
                    + the /coach/* endpoints: chat, threads, confirm, insight, review,
                    design-program, parse-workout, parse-food-photo, photo-note, compare-photos
  api.py            REST for the PWA (/api/*): home, program/today, sessions, sets, weight,
                    trends, nutrition, foods, meals, vitals, measurements, photos, programs,
                    catalog, profile, onboarding, export
  graph.py          LangGraph coach: hydrate→screen→agent→tools→safety→commit→guard
                    (+ evidence summarisation and proposal diffs for the UI)
  tools.py          the agent's read tools + propose_* tools (stage only, never write)
  llm.py            model FAILOVER for every LLM surface (COACH_MODELS, cooldown memory,
                    CoachUnavailable -> 503 with retry_at). Always build models through it.
  review.py         weekly-review graph (scheduled; target writes are engine-owned)
  run_review.py     review batch: daily timer + --if-missing (self-healing), pushes the result
  notify.py         push to the phone via self-hosted ntfy (no-op when unconfigured)
  daily.py          08:30 job: one calm nudge (workout / weigh-in) + stale-session housekeeping
  adaptive.py       deterministic adaptive-calorie-target engine (observed maintenance from
                    logs; the ONLY source of automated target adjustments)
  safety.py         deterministic gate: target/program checks, goal-rate cap, content
                    screening, canonical crisis copy, initial-target estimator
  insight.py        one-shot grounded "here's what I noticed" note for Home
  energy.py         MET-based kcal estimates for cardio/activities (ACSM incline maths)
  programs.py       curated program templates + the design-from-a-goal prompt
  parse.py          natural-language workout parsing ("describe a workout you did")
  vision.py         food-photo and progress-photo vision calls
  media.py          private on-disk media store for progress photos
  catalog.py        in-memory exercise catalog + variant index (loaded from seed/)
  models.py         pydantic models (DB shapes, proposals, structured outputs)
  auth.py           JWT verification -> user_id (the security boundary)
  pg_repo.py        PostgresCoachRepo (implements repo.CoachRepo); all the SQL
  repo.py           CoachRepo protocol (the data boundary)
  ingest.py         builds seed/ from free-exercise-db (public domain)
  rag/              corpus governance, pgvector store, cited-answer pipeline
  eval/             LLM-as-judge harness (grounding + usefulness)
  migrations/       001..017 (list below); 002 is Supabase-only and skipped
  tests/            pytest suite (safety, adaptive, graph, review, catalog, energy, programs,
                    rag, eval, store contract, DB integration)
  smoke_test.py     repo validation vs live Postgres
  e2e_test.py       full vertical slice vs live PG (model scripted)
web/
  app/              routes: / (Home) /workout /train /history /program /nutrition /trends
                    /coach /settings /onboarding  (+ /programs -> redirects to /train)
  components/       screens (Home, WorkoutPlayer, ProgressView, FoodView, CoachView, ...)
  components/ui/    design-system primitives: Sheet, Empty, Ring, PageHeader
  lib/theme.ts      the five looks + the no-flash stamping script
  lib/queue.ts      IndexedDB offline write queue (replays on reconnect)
  lib/pairing.ts    QR sign-in (parse /pair#t= | gymcoach://pair | raw token; store it)
  lib/deeplinks.ts  gymcoach:// -> route (notification taps, shortcuts)
  native-shell/     the Android app's local files: offline page only (the UI is loaded live)
  app/globals.css   design tokens (one CSS-variable block per look) + type scale + components
  e2e/              Playwright read-only pass over every screen
  android/          Capacitor shell around the LIVE site (server.url): Health Connect, deep links,
                    home-screen shortcuts, camera, notifications
seed/               committed catalog seed (exercises + variant graph)
scripts/migrate.sh  tracked migration runner (schema_migrations table)
dev_up.sh           one-command local bring-up (Postgres + migrations)
pair.py             QR codes in the terminal: install the APK, subscribe to pushes, sign in
mint_token.py       mint a bearer token (pair.py is the friendlier way)
```

Migrations: `001_core`, `002_rls_supabase` (Supabase-only, skipped), `003_targets_append_only`,
`004_pgvector`, `005_vitals`, `006_food_entries`, `007_cardio`, `008_set_type`, `009_food_macros`,
`010_meals`, `011_measurements`, `012_progress_photos`, `013_belly`, `014_coach_messages`,
`015_set_incline`, `016_program_goal`, `017_program_schedule`.

## Setup & commands

```bash
# 1. Python deps (repo .venv on this machine)
pip install -r requirements.txt

# 2. Postgres 16 + pgvector
./dev_up.sh                         # creates role/db, then runs scripts/migrate.sh (tracked)

# 3. Env — see .env.example; on this machine `.env` is already filled in:
set -a; . ./.env; set +a            # COACH_DB_URI, COACH_SEED_DIR, SUPABASE_JWT_SECRET (required),
                                    # COACH_MODEL + OPENAI_BASE_URL/KEY (the CLI proxy),
                                    # COACH_EMBED_* + EMBED_DIM (the LiteLLM gateway),
                                    # COACH_PUBLIC_URL (the served URL; the APK loads it),
                                    # COACH_MODELS (failover chain), COACH_NTFY_* (pushes)

# 4. Run (ports on this machine: backend 8010, frontend 3010 — 8000/3000 are taken)
uvicorn coach.service:app --port 8010
cd web && npm run build && npm start -- --port 3010     # Node 20; `next dev` hits this
                                                        # machine's inotify limit — use build

# 5. Connect the phone, then the first-run wizard
python pair.py                      # scan the codes; "Scan pairing code" in the app

# Tests
python -m pytest coach/tests -q                    # 117 pass, 8 DB tests skip without a DSN
COACH_DB_URI=... python -m pytest coach/tests -q   # 125 pass (DB tests use a throwaway user)
cd web && npm test                                 # Vitest (offline queue, pairing, deep links)
cd web && TK=<token> npm run test:e2e              # Playwright, needs the stack running
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.smoke_test
COACH_DB_URI=... COACH_SEED_DIR=... python -m coach.e2e_test
```

LLM: every coach surface builds its model with `llm.build_model()`, which reads the ranked
`COACH_MODELS` chain (falls back to `COACH_MODEL`). This deployment runs `openai:gpt-5.5`,
`openai:claude-sonnet-5`, `openai:gemini-3.8-flash-high` through the local CLI proxy. Structured
output defaults to `method="function_calling"` because non-OpenAI models ignore `response_format`
through the proxy's shim. **Never construct a model with `init_chat_model` directly in app code**
— a single model is a single point of failure (see SYSTEM_OVERVIEW §10).

## Architecture invariants — do not break

- **The LLM proposes; the system disposes.** The model never writes. It calls read tools and
  `propose_*` tools that only *stage* a typed change; only the `safety` and `commit` graph nodes
  touch the DB. Keep writes unreachable from the model.
- **`user_id` comes only from the verified JWT** (`auth.get_current_user_id`), never a request
  body or tool argument. Tools read it from `RunnableConfig`.
- **Auth fails closed.** `SUPABASE_JWT_SECRET` is required: `auth.require_jwt_secret()` runs in
  the service lifespan and `get_current_user_id` refuses to verify without it. Never restore a
  default/empty secret — PyJWT will happily validate tokens signed with `""`, which is a total
  auth bypass. Covered by `coach/tests/test_auth.py`; keep those tests passing.
- **No credential ever enters the repo.** Tokens are minted locally and pasted on the device;
  don't commit one, print one into a doc, or screenshot the Setup screen with one visible.
  (A token leaked this way once, via a README screenshot — the fix was rotating the secret.)
- **`targets` is append-only** (DB trigger, migration 003). Express a change by inserting a new
  row with a rationale; never UPDATE/DELETE history. (Test fixtures that must delete a throwaway
  user suspend the trigger inside one transaction — product code never does.)
- **All offline-capable writes are idempotent** (client-generated UUIDs + `ON CONFLICT DO
  NOTHING`, or natural-key upsert for nutrition). The PWA replays a queue on reconnect — keep
  new write endpoints idempotent.
- **Cross-user/missing writes fail loudly** (raise), never silent no-ops.
- **The coach is optional at startup.** Missing LLM config must not take down the logging API —
  coach endpoints return 503; everything else keeps working.
- **The coach is resilient at runtime.** A rate-limited or failing model falls back to the next in
  `COACH_MODELS`; only when all fail is it a 503 — with `retry_at`, so the UI can say when it's
  back instead of "try again shortly". Scheduled jobs must never fail silently: model outages are
  deferred and alerted in-process; anything else exits non-zero so `OnFailure=` pushes an alert.

## Safety & wellbeing invariants — do not weaken

This is a health-adjacent product. These are deliberate and must be preserved:
- **Calorie floors + single-step + goal-rate caps live in code** (`safety.py`), not the prompt.
  The onboarding starting target is computed conservatively and **clamped to the floors** before
  it is ever written; the goal rate is capped server-side.
- **Calorie-target adjustments are system-owned** (`adaptive.py`): the weekly review applies a
  change only on the engine's `adjust` verdict, still through `check_target_change`; the chat
  coach must propose the engine's `suggested_target_kcal`, never its own number. Thin or
  under-logged data yields *insufficient*/*underlogged* (hold) — never a cut. Keep the LLM out
  of the compute path.
- **Eating-disorder history disables automated calorie targets entirely.** Onboarding creates no
  target on that path; the coach refuses target changes; the engine returns `disabled`. Do not
  add a code path that produces targets when this flag is set.
- **No UI ever suggests calorie/macro numbers.** Users log their own intake; targets come only
  from onboarding/engine/coach. The Food screen leads with protein as a goal and shows calories
  plainly with no over/under verdict. Progress shows the maintenance *estimate*, never a
  suggested target. Keep this framing.
- **Nudges stay calm** (`daily.py`): at most one a day, only when there's something to do, no
  guilt/streak-loss language, back off to Mondays after 14 quiet days, and **never a weigh-in
  prompt for users with eating-disorder history**. Covered by `tests/test_resilience.py`.
- **Content screening** (inbound + outbound) routes disordered-eating / self-harm /
  extreme-deficit / train-through-injury signals to support, never to optimized advice.
- **Crisis copy is single-sourced in `safety.py`** (`REDIRECTS` / `redirect_for`): numberless, no
  appearance commentary, region-appropriate. The support resource is operator-set via
  `COACH_SUPPORT_RESOURCE`. **Never hardcode a national helpline; do NOT use the NEDA Helpline
  (discontinued).** This prohibition is documented in the code — keep it.

## UI invariants (the 2026-09-12 redesign)

- **Everything is tokens.** Colour comes from the CSS variables in `app/globals.css`
  (`bg-ink`, `bg-panel`, `bg-panel2`, `card-lift`, `text-bone`, `text-dim`, `border-line`,
  `bg-volt`, `text-onvolt`, plus `good`/`warn`/`alert` and the `food`/`vitals` category hues).
  **Never hardcode a colour** — five looks (including a light one, Paper) must all stay legible,
  and text on the accent must use `text-onvolt`, not white or ink.
- **Type comes from the scale**: `t-hero` (44) · `t-title` (28) · `t-h2` (20) · body 15 ·
  `t-sec` (13) · `eyebrow` (11 mono caps). `tnum` wherever digits align. Don't invent sizes.
- **Logging happens in a `Sheet`; screens are for seeing.** No screen keeps a form open. New
  input goes in a bottom sheet with a title, a couple of fields and one primary action.
- **One lifted object per screen** (`card-lift`) — today's workout, the weight hero, the weekly
  review. Everything else is a flat section with `row` dividers. Not everything is a card.
- **Empty states get one line and one action** (`ui/Empty`), never a paragraph and never a
  zero-hero. Thin data shows a calm "building" note, not a lecture.
- **Affordances, not instructions.** If a thing is tappable it looks tappable; don't write
  "tap to edit".
- **Motion is cheap and purposeful**: `rise` staggers only the first few children; spend real
  motion on logging a set, a PR, and finishing a workout. Respect `prefers-reduced-motion`.

## Current status

**Live and running** on the owner's Linux desktop as systemd user services, served to their
Android phone over Tailscale at `https://gym-coach.<your-tailnet>.ts.net` (tailnet-only
HTTPS) as a PWA and a sideloaded Capacitor APK that loads the live site. The coach runs on a
**failover chain via the local CLI proxy** (gpt-5.5 → claude-sonnet-5 → gemini-3.8-flash);
embeddings via a **LiteLLM→Ollama** gateway; RAG corpus populated (257 chunks). The server reaches
the phone through a self-hosted **ntfy** (weekly review, morning nudge, failure alerts); phones
sign in by **QR** (`pair.py`). Restart-resilient (`Restart=always`, linger on). All suites green:
125 pytest, 11 Vitest, 12 Playwright.

**Read [`docs/SYSTEM_OVERVIEW.md`](docs/SYSTEM_OVERVIEW.md) first** — it documents the whole
running system (architecture, ports, services, LLM wiring, phone access, operations) for the
next human/agent. Then [`deploy/README.md`](deploy/README.md),
[`deploy/PHONE_ACCESS.md`](deploy/PHONE_ACCESS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

**Built since the original baseline:** food-database nutrition logging (Open Food Facts +
barcode + photo + saved meals + macros), adaptive calorie targets, vitals (BP/HR), body
measurements + progress photos, cardio + natural-language workout logging, PR/e1RM analytics,
proactive coach insights, workout history, program library (templates + design-from-a-goal),
weekly-review scheduler, nightly DB backup, data export, daily reminders, the Capacitor Android
app with Health Connect sync, the Tailscale phone deploy, and the full UI redesign (five looks,
workout player, sheet-based logging).

**Open before a real launch:** a **clinician signs**
[`deploy/SAFETY_REVIEW.md`](deploy/SAFETY_REVIEW.md); always-on availability (the app is up only
while this machine is awake — the always-on path is the droplet+domain version keeping the LLM
here over Tailscale); import/restore to complete the export story.

## Gotchas

- **The Android app loads the live site** (`server.url`). UI changes need only a web rebuild +
  `coach-frontend` restart; rebuild the APK (`deploy/build-apk.sh`, which also republishes it)
  only for native changes. Test APKs on the emulator first — recipe in `deploy/ANDROID_APP.md`.
- **Tests don't show whether the product is used.** Before calling anything done, read
  `journalctl --user -u coach-backend` for the phone's tailnet IP: 401s mean it's signed out.
- **Frontend needs Node 20** (`nvm use 20`) — Tailwind v4 oxide. `next dev` trips this machine's
  inotify watcher limit, so always build + `next start`.
- `web/` install can collide with a global `~/.npmrc` `prefix` setting; if `npm install` errors
  on prefix, that's why.
- Migrations are **tracked** (`schema_migrations` via `scripts/migrate.sh`), so re-running is
  safe on both fresh and existing databases.
- `seed/` is committed; regenerate with
  `python -c "from coach.ingest import build; build('exercises_raw.json','seed')"` if you
  re-ingest.
- README screenshots are taken against a **throwaway seeded user** that is deleted afterwards —
  never use the real account's data for docs.
