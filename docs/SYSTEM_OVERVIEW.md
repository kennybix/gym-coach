# Gym Coach — System Overview (for humans and agents)

A single-user weight-loss training PWA with an AI coach. **The entire app runs on one Linux
machine** (`quantoptimus`, the user's desktop) and is served to the user's phone over
**Tailscale** with HTTPS. This document is the hand-off: read it to understand and operate
the whole system without rediscovering it.

> Companion docs: [`../CLAUDE.md`](../CLAUDE.md) (architecture + safety invariants),
> [`deploy/README.md`](../deploy/README.md) (systemd units), [`deploy/PHONE_ACCESS.md`](../deploy/PHONE_ACCESS.md)
> (phone setup), [`deploy/SAFETY_REVIEW.md`](../deploy/SAFETY_REVIEW.md) (clinician checklist),
> [`deploy/litellm/README.md`](../deploy/litellm/README.md) (embeddings gateway).

---

## 1. The non-negotiable constraint

The LLM is **bolted to this machine**: chat goes through a local **CLIProxyAPI**
(`:8317`, subscription-backed — Claude/Codex/Gemini/Kimi at no per-token cost), and the
shared **SmartLLMRouter** lives in another project on this box. Because the model can't move,
**Postgres, the backend, the frontend, and the embeddings gateway all run here too.** The
remote droplet is *not* used by gym-coach. The phone reaches this machine; if the machine is
off/asleep, the app is down (acceptable — it's a personal tool, and the machine is kept on).

---

## 2. Architecture

```
 Samsung S26+ (Tailscale ON)
        │  https://gym-coach.taile8b1de.ts.net   (tailnet-only, real TLS)
        ▼
 tailscaled  ──►  `tailscale serve`  (root → 127.0.0.1:3010)
        ▼
 coach-frontend :3010  (Next.js 15, "next start", Node 20)
   ├─ serves the PWA UI
   └─ Next rewrites proxy  /api  /coach  /knowledge  ──►  coach-backend :8010
        ▼
 coach-backend :8010  (FastAPI / uvicorn)
   ├─ Postgres  (system service, db `coachdb`)            ── all user data
   ├─ chat   →  CLIProxyAPI :8317   via  openai:gpt-5.5    ── coach + insights + review
   └─ embeddings → LiteLLM :4000 → Ollama :11434 (mxbai-embed-large, 1024-d)  ── RAG
```

**Single origin** is the key trick: the frontend proxies the API, so from the browser
everything is one host → no CORS, no path-prefix surprises, and one TLS cert. The same build
works on `localhost:3010` (rewrites hit the local backend) and on the `ts.net` URL.

---

## 3. Components, ports, how they run

| Component | Port | Manager | Unit / source |
|---|---|---|---|
| Postgres (`coachdb`) | 5432 | **system** systemd | `postgresql.service` (enabled) |
| Ollama (embeddings) | 11434 | **system** systemd | `ollama.service` (enabled) |
| CLIProxyAPI (chat) | 8317 | **user** systemd | `cli-proxy.service` (enabled) — owned by another project |
| LiteLLM gateway | 4000 | **user** systemd | `coach-litellm.service` |
| Backend (FastAPI) | 8010 | **user** systemd | `coach-backend.service` |
| Frontend (Next PWA) | 3010 | **user** systemd | `coach-frontend.service` |
| Tailscale node (dedicated) | — | **user** systemd | `gym-coach-tailscaled.service` (userspace tailscaled) |
| Tailscale serve re-apply | — | **user** systemd | `gym-coach-serve.service` (oneshot, boot) |
| Weekly review | — | **user** timer | `coach-review.timer` → `coach-review.service` (Mon 07:00) |
| Nightly DB backup | — | **user** timer | `coach-backup.timer` → `coach-backup.service` (02:30) |

Unit sources live in [`deploy/systemd/`](../deploy/systemd/); installed copies in
`~/.config/systemd/user/`. **Restart resilience:** every long-running unit is
`Restart=always` + `StartLimitIntervalSec=0`, so it retries forever until its (possibly
system-managed) dependencies are ready — boot order cannot break it. **Linger is enabled**
(`loginctl enable-linger`), so user services start at boot without a login session. Verified:
hard-killing the backend revives it in ~7s; full chain survives reboot.

---

## 4. LLM wiring (the important, non-obvious part)

- **Chat** (coach graph, weekly review, proactive insight): langchain `init_chat_model`
  with `COACH_MODEL=openai:gpt-5.5` + `OPENAI_BASE_URL`/`OPENAI_API_KEY` pointing at the CLI
  proxy (`http://127.0.0.1:8317/v1`). The proxy is OpenAI-compatible, so this needs **zero
  app code** — just env. (Gemini chat also works via the proxy, but its **structured-output**
  path fails through the OpenAI shim — returns prose not JSON — so keep review/judge on gpt-5.5.)
- **Embeddings** (RAG): the CLI proxy has **no** embeddings endpoint. So a **LiteLLM gateway**
  (`:4000`) exposes `/v1/embeddings` backed by local **Ollama `mxbai-embed-large` (1024-d)** —
  free, private. gym-coach `.env`: `COACH_EMBED_BACKEND=litellm`, `EMBED_DIM=1024`.
  The shared **SmartLLMRouter** was also extended with embeddings failover
  (`create_embeddings_with_failover`) in the trading_intelligence project.
- **No embeddings from subscriptions exist** (Anthropic has none; OpenAI/Gemini embeddings are
  API-billed) — that's why local Ollama is the answer.

---

## 5. Data layer

Postgres db `coachdb`, role `coach`/`coach`. **17 migrations** in
[`coach/migrations/`](../coach/migrations/), applied by the tracked runner
[`scripts/migrate.sh`](../scripts/migrate.sh) (a `schema_migrations` table records what ran, so
re-running is safe on fresh *and* existing databases):

| | |
|---|---|
| `001_core` | profiles, programs, program_exercises, sessions, set_logs, body_metrics, nutrition_logs, targets, coach_reviews |
| `002_rls_supabase` | Supabase-only — **skipped** by the runner |
| `003_targets_append_only` | trigger enforcing target history |
| `004_pgvector` | rag_chunks, **vector(1024) + HNSW** (ivfflat missed rows on a small corpus) |
| `005_vitals` | blood pressure + heart rate, many per day |
| `006_food_entries` `009_food_macros` `010_meals` | item-level food log, carbs/fat/fiber, saved meals |
| `007_cardio` `008_set_type` `015_set_incline` | duration/distance, warmup/drop/failure tags, treadmill incline |
| `011_measurements` `013_belly` `012_progress_photos` | tape measurements, belly site, private photo journal |
| `014_coach_messages` | chat transcripts (survive a reinstall) |
| `016_program_goal` `017_program_schedule` | program goal text, per-weekday scheduling |

LangGraph checkpoint tables are auto-created by `AsyncPostgresSaver`. `dev_up.sh` bootstraps a
fresh DB end to end.

---

## 6. Phone access (Tailscale Serve)

- **URL:** `https://gym-coach.taile8b1de.ts.net` — **tailnet-only** (Serve, *not* Funnel),
  so nothing is public; the user's signed-in devices are the gate, the JWT is the data auth.
- Served from its **own dedicated userspace tailscaled node** (`gym-coach-tailscaled.service`,
  state in `~/.local/share/tailscale-gym-coach/`), so this app owns its hostname and serve
  config and can't clobber the sibling `mynah` app. `gym-coach-serve.service` re-asserts the
  mapping at boot. Inspect it with
  `tailscale --socket=~/.local/share/tailscale-gym-coach/tailscaled.sock serve status`.
  (The older shared mapping on the main node, `coach-tailscale-serve.service`, is retired and
  disabled — one serve config per node made the shared link fragile.)
- Set up once: enable HTTPS in the Tailscale admin console and
  `sudo tailscale set --operator=$USER`.
- **Also installable as an APK** — the Capacitor shell adds Health Connect import and local
  notifications ([`deploy/ANDROID_APP.md`](../deploy/ANDROID_APP.md)); it's served for
  sideloading at `/gym-coach.apk`.
- **No credentials in the JS bundle** — the bearer token is pasted once under
  **Setup → Signed in** and kept in the device's localStorage. `web/.env.local` must NOT contain `NEXT_PUBLIC_DEV_TOKEN`
  for any served build. `apiBase()` returns same-origin (relative) so the Setup "API URL" is
  optional. Mint a token: `SUPABASE_JWT_SECRET=... python mint_token.py <uuid>`.
- To go **public** later (share beyond the tailnet): custom domain via the droplet
  (`gym.quantoptimus.com` → droplet nginx → Tailscale → this machine), or `tailscale funnel`
  — **add an auth layer first** (e.g. nginx basic-auth).

---

## 7. Operating it

```bash
# status / logs
systemctl --user status coach-backend coach-frontend coach-litellm
journalctl --user -u coach-backend -f
systemctl --user list-timers 'coach-*'

# after a BACKEND code change
systemctl --user restart coach-backend
# after a FRONTEND code change (must rebuild — next start serves the build)
cd ~/Documents/Projects/gym-coach/web && nvm use 20 && npm run build && systemctl --user restart coach-frontend

# run the weekly review now / back up now
systemctl --user start coach-review.service
systemctl --user start coach-backup.service        # → ~/.local/share/gym-coach/backups/

# RAG: rebuild the corpus
cd ~/Documents/Projects/gym-coach && set -a; . ./.env; set +a
./.venv/bin/python -m coach.rag.fetch_sources --sources seed/rag_sources.json --out /tmp/c.json
./.venv/bin/python -m coach.rag.ingest_corpus --manifest /tmp/c.json

# tests — backend (98 with a DSN; the 8 DB tests skip without one), web unit, web e2e
./.venv/bin/python -m pytest coach/tests -q
cd web && npm test                                   # Vitest: the offline queue
cd web && TK=$(python ../mint_token.py <uuid> | awk '/token:/{print $2}') npm run test:e2e

# rebuild the Android APK (then RESTORE the server build — see the gotcha below)
bash deploy/build-apk.sh && (cd web && npm run build) && systemctl --user restart coach-frontend

# restore a backup
gunzip -c <file>.sql.gz | PGPASSWORD=coach psql -h localhost -U coach -d coachdb
```

**Toolchain gotchas:** frontend needs **Node 20** via nvm (Tailwind v4 oxide); `next dev`
trips this machine's inotify watcher limit, so production build + `next start` is used.
Python backend uses the repo `.venv`. Secrets live in `.env` (gitignored).
**The APK build clobbers the server build** — `deploy/build-apk.sh` runs
`NATIVE_BUILD=1 next build` (static export), so always re-run `npm run build` and restart
`coach-frontend` afterwards or the served site becomes the static export.

---

## 8. Feature surface (so you know what exists)

**UI redesign (2026-09-12, `a46671f` → `9b33665`).** Tabs are now **Home / Train / Food /
Progress / Coach**, Setup sits behind the gear on Home. Five user-selectable **looks** (Volt,
Paper, Ember, Glacier, Mono + Auto) are CSS-variable blocks on `<html data-theme>` (`web/lib/theme.ts`,
`ThemePicker`, no-flash inline script in `layout.tsx`). Type: Bricolage Grotesque / IBM Plex Sans /
IBM Plex Mono with a fixed scale (`t-hero/t-title/t-h2/t-sec/eyebrow`). Primitives in
`web/components/ui/` (Sheet, Empty, Ring, PageHeader). Every log is a bottom sheet; no screen keeps a
form open. Old components (SessionLogger, TrendsView, NutritionView, FoodLog, VitalsCard, InsightCard)
are gone — see `Home`, `WorkoutPlayer`, `ProgressView`, `FoodView`/`FoodAddSheet`, `VitalsSection`,
`CoachNote`. `/api/home` feeds Home in one call; `/api/trends` adds `latest_weight`.
The screen list below describes the redesigned surface.

- **Home** (`/`) — greeting, today's workout as one lifted object (count, ~minutes, set pills,
  Start/Continue), quick-log tiles (weigh-in + BP sheets, food), one-line coach note, compact
  plan list, this-week tiles. **Workout player** (`/workout`) — one exercise at a time, big
  fields, rest timer, prev/next, all-exercises + add sheets, PR flag, finish summary.
  **Train** (`/train`) — program library (cards, on/off, day chips, add/review sheets) +
  History (`/history`, sessions → sets, edit via sheet); per-program editor at `/program?id=`.
- **Progress** (`/trends`) — weight hero (latest/last-known, goal distance, honest trend or
  building note, tap-a-point edit sheet), week tiles, energy balance (adaptive estimate +
  confidence, or what's still needed — never a suggested target), vitals (sparklines, edit
  sheet), body measurements + photos as expandable sections, '+' log sheet.
- **Food** (`/nutrition`) — protein ring + plain calories, 7-day strip (tap a day), today's
  entries, one add sheet (search / recent / saved meals, barcode, photo, or a day total).
- **Coach** — identity mark, verdict-first weekly review, suggested prompts, prose replies +
  evidence chips, history/confirm sheets; grounded chat (reads real logs, proposes→safety→commit).
- **Setup** — Look picker, Your details + Access token rows (sheets), sync, reminders, Health
  Connect (native), export/backup.
- **Onboarding** (`/onboarding`) — five steps then a summary: pick a look, about you, goal +
  pace, health flags (injury / disordered-eating history / optional baseline vitals), program
  (template, coach-designed from a goal, or built from the catalog), then the starting point and
  what happens next. The tab bar is hidden during first run; Home redirects a fresh token here.
- **Knowledge** — `/knowledge/ask` cited answers over a vetted RAG corpus (CDC/NHS/MedlinePlus/
  OpenStax, ~257 chunks, governance-gated, openly-licensed).

**REST beyond the original baseline** — `/api/home` (everything Home needs in one call),
`/api/trends` (adds `adaptive` + `latest_weight`), `/api/sets/{sync,delete,update}`,
`/api/sessions`, `/api/metrics/weight/{set,delete}`, `/api/vitals(+update/delete)`,
`/api/foods/{search,recent,barcode,log,delete}`, `/api/meals(+log/delete)`,
`/api/measurements(+delete)`, `/api/photos(+update/delete)`, `/api/exercise/{id}/stats`,
`/api/programs(+templates/template/{key}/active/schedule/update/delete/clear-inactive)`,
`/api/profile`, `/api/export`; and on the coach side `/coach/{insight,threads,review/latest,
design-program,parse-workout,parse-food-photo,photo-note,compare-photos}`.

---

## 9. Safety model (do not weaken)

- **"LLM proposes, system disposes":** the model only stages typed proposals; only the
  `safety`→`commit` graph nodes write. Calorie floors / rate caps live in code (`coach/safety.py`),
  not the prompt. Eating-disorder history disables automated calorie targets entirely.
- Thresholds are **evidence-aligned** to CDC/NHS guidance (floors 1200/1500 kcal; 0.5–1 kg/wk)
  and documented, but **a clinician must still sign** [`deploy/SAFETY_REVIEW.md`](../deploy/SAFETY_REVIEW.md) before launch.
- Inbound/outbound content screening catches disordered-eating, self-harm, numeric
  extreme-deficit, rapid-loss intent, train-through-injury → supportive redirect.
- **Adaptive calorie targets are system-owned** (`coach/adaptive.py`): observed maintenance =
  avg logged intake − weight-slope×7700, blended with Mifflin-St Jeor; requires ≥4 weigh-ins over
  ≥14d and ≥10 logged days at ≥50% coverage; an observed number <75% of the formula is treated as
  under-logging → *hold*, never a cut; ±10% max step, 100 kcal dead band, 14-day cooldown, floors.
  The unattended weekly review writes a target ONLY on the engine's `adjust` verdict (still via
  `safety.check_target_change`); the LLM's own idea is recorded as `llm_advised_target`, never
  applied. ED history → engine `disabled`.
- Vitals: coach comments freely (operator choice) with a prompt-level nudge to seek care for
  clearly dangerous readings; **no hard vitals guardrail** (flagged for review).
- Auth: every endpoint requires a verified JWT (`coach/auth.py`); `user_id` comes only from the
  token, never a request body.

---

## 10. Open items (pre-real-launch)

1. **Clinician signs** the safety checklist ([`deploy/SAFETY_REVIEW.md`](../deploy/SAFETY_REVIEW.md)).
2. **Availability** beyond this machine — only up while the desktop is awake; the always-on
   alternative is the droplet+domain (Path B), keeping the LLM here over Tailscale.
3. **Import/restore** — export is done; the other half completes the data-ownership story.
4. **Device-side QA after each APK** — run [`deploy/DEVICE_SMOKE.md`](../deploy/DEVICE_SMOKE.md);
   WebView camera/keyboard/safe-area bugs only show on the phone.
5. Housekeeping: `profiles` holds a few stale test users from earlier bring-up work, and
   `run_review` iterates every profile — prune them if the weekly-review log gets noisy.
