# Product Readiness Review - 2026-06-05

> **Historical snapshot.** Kept for the reasoning and evidence behind the roadmap; it
> describes the app as it was on this date, before the Phase 1–2 work and the 2026-09-12 UI
> redesign. For the current state see [`ROADMAP.md`](ROADMAP.md) and
> [`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

This review answers a blunt product question: is the current app something a normal
fitness customer would likely pay to use?

## Verdict

Not yet.

I would use it as a personal beta. I would not pay for it today as a normal fitness
customer, and I would not sell it yet. The app has moved beyond a technical prototype,
but paid fitness software has to earn trust in three areas: data reliability, safety,
and repeat-use polish. The current app is close, but it still has blockers in all three.

## Why It Is Getting Close

- The daily workout loop is now credible: start session, log multiple sets, remove a
  bad set, add an exercise for today, and use a rest timer.
- The app no longer depends on SQL or seed scripts for normal setup. Onboarding includes
  profile, goal, safety screening, and program creation.
- The program editor is a major product unlock: add, remove, reorder, and retarget
  exercises from the catalog.
- Trends and nutrition are framed behaviorally instead of as shame-heavy scoreboards.
- The coach concept is differentiated: it can read real logs, propose changes, and route
  mutations through deterministic safety checks.
- The PWA has a coherent mobile shape: bottom navigation, install manifest, dark gym-floor
  UI, offline write queue, and typed numeric controls.

## Why I Would Not Pay Yet

### Trust Blocker: Auth Can Fail Open

`coach/auth.py` defaults `SUPABASE_JWT_SECRET` to an empty string. If the secret is
missing, tokens signed with the empty HS256 key can authenticate.

This blocks any paid or hosted use. A customer should never have to wonder whether their
training, body weight, nutrition, or screening flags are protected by a real auth boundary.

Relevant file:

- `coach/auth.py`

### Trust Blocker: Offline Queue Can Drop Recoverable Writes

The offline queue deletes any 4xx write during flush. That is reasonable for permanently
bad payloads, but it is dangerous for expired tokens, misconfigured API base URLs, or
temporary auth/config problems.

For a workout logger, silent data loss is a deal-breaker. If I log a hard session and the
app discards those writes without a clear recovery path, I stop trusting it.

Relevant file:

- `web/lib/queue.ts`

### Reliability Blocker: Full Test Collection Still Fails

The focused app tests pass, but `.venv/bin/pytest -q` fails because manual live-DB smoke
checks are collected and import `COACH_DB_URI` at module import time.

This is not a user-facing bug by itself, but it weakens engineering confidence. A paid
product needs a clean default test command.

Relevant files:

- `coach/smoke_test.py`
- `coach/e2e_test.py`

### Trust Blocker: RAG Grounding Is Not Strong Enough

RAG currently retrieves chunks, asks the model to answer, then marks the answer grounded
and attaches retrieved citations. It does not prove the model actually used those
sources or that each claim is supported.

For general fitness facts this is already risky. For anything adjacent to nutrition,
injury, or safety, it needs stricter support verification.

Relevant files:

- `coach/rag/answer.py`
- `coach/rag/pgvector_store.py`

### UX Blocker: Coach Confirmation Can Be Confused

The coach can show a safety confirmation interrupt while the normal chat input remains
active. That can desync the user's visible flow from the backend checkpoint state.

Paid users will not understand "LangGraph interrupt state." They will experience it as
the coach being flaky.

Relevant file:

- `web/components/CoachView.tsx`

## What Feels Payworthy Already

### The Core Loop

The Today screen is close to useful enough for daily use. The combination of planned
exercises, ad-hoc additions, multiple-set logging, deletion, rest timing, and offline
sync is the kind of basic utility a gym app needs before it can sell the AI layer.

### The Coach Architecture

The important product idea is not "chat with a fitness bot." It is "a coach that reads
my actual logs and can safely change plan state." The deterministic safety gate is the
right foundation for that.

### Program Ownership

Letting users edit their program directly changes the feel of the app. It becomes a tool
they can live in, not just a scripted onboarding demo.

### Safety Posture

The app is already more thoughtful than many fitness products around aggressive weight
loss, disordered eating history, and injury. The current deterministic layer is not
enough for launch by itself, but the product direction is right.

## What Would Make Me Pay

I would reconsider after these are true:

1. Auth fails closed and has a regression test.
2. Offline writes are never silently discarded for recoverable auth/config problems.
3. The default test command passes cleanly.
4. One live Postgres plus real LLM smoke path is documented and passing.
5. Coach confirmation locks the chat input until approve/decline resolves.
6. RAG citation/support verification is stricter than "retrieved nearby text."
7. There is a clear data export, backup, and restore path for the user.
8. There is at least one week of real personal usage without data loss or coach-state bugs.

## Pricing Readiness

Current state:

- Personal beta: yes.
- Private alpha with trusted testers: yes, after auth fail-closed is fixed.
- Paid single-user product: not yet.
- Hosted multi-user subscription: no.

Likely first paid shape:

- A low-cost personal coach/logger for technically comfortable users who can self-host or
  run a private instance.
- The strongest pitch is not a generic AI trainer. It is a privacy-focused training log
  with a coach that reads real behavior and can safely adapt the plan.

Do not position it as medical, clinical, eating-disorder support, injury rehab, or a
guaranteed weight-loss program.

## Verification Snapshot

Commands run during review:

```bash
.venv/bin/pytest -q coach/tests
npm run build
.venv/bin/pytest -q
```

Observed result:

- `.venv/bin/pytest -q coach/tests`: passed, 55 tests.
- `npm run build`: passed.
- `.venv/bin/pytest -q`: failed during collection because manual live-DB checks import
  `COACH_DB_URI` before checking whether that environment is configured.

## Recommended Product Fix Order

1. Fix auth fail-open.
2. Fix offline queue data-loss behavior.
3. Fix default pytest collection.
4. Lock coach confirmation state.
5. Run and document a live real-LLM flow.
6. Tighten RAG grounding and re-ingest behavior.
7. Add user-facing backup/export/restore.
8. Use it for a full training week and capture friction before adding more features.
