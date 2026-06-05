# Engineering Review - 2026-06-05

This note captures the current review of the Gym Coach work in progress. It is written
as an action list: fix the `P0` items before using the app anywhere outside private
local development, then work down the list.

## Current Strengths

- The core coach architecture is sound: the LLM proposes changes, deterministic code
  decides whether they can be committed, and the repository layer performs the writes.
- User isolation is handled at the data boundary. Endpoints derive `user_id` from a
  verified bearer token, and repository calls scope queries by that `user_id`.
- Plan changes have auditability. Targets are append-only, include `source` and
  `rationale`, and weekly reviews record status, summary, and committed changes.
- The PWA is becoming a usable product, not just an API shell: offline/idempotent
  logging, onboarding, trends, nutrition, coach history, markdown replies, and install
  support are all present.
- The RAG direction is right: source manifest, license governance, provenance-carrying
  chunks, pgvector retrieval, and shared safety redirects.
- Single-host deployment has started to become operational: systemd units, LiteLLM
  gateway, review timer, and database backups are now represented in the repo.

## P0 - Fix Before Non-Local Use

### Auth Must Fail Closed

`coach/auth.py` currently defaults `SUPABASE_JWT_SECRET` to an empty string. If the
secret is absent, PyJWT will accept HS256 tokens signed with the empty key.

Fix:

- Require `SUPABASE_JWT_SECRET` at startup.
- Reject empty strings and placeholder values like `change-me`.
- Add a regression test that proves an unset/empty secret cannot authenticate.

Relevant file:

- `coach/auth.py`

### RAG Upsert Leaves Stale Text And Provenance

`PgVectorStore.add()` updates only `embedding` on `chunk_id` conflict. If source text,
license metadata, attribution, or chunk ordering changes, the row can keep stale text
while receiving a fresh vector.

Fix:

- On conflict, update `doc_id`, `idx`, `text`, `provenance`, and `embedding`.
- Consider deleting existing chunks for a `doc_id` before re-ingesting that document so
  removed chunks do not linger.
- Add a pgvector-backed integration test or a small fake-connection test for the SQL.

Relevant file:

- `coach/rag/pgvector_store.py`

## P1 - Tighten Before Relying On It Daily

### Full Pytest Collection Is Broken By Manual Tests

`coach/smoke_test.py` and `coach/e2e_test.py` are intended to be manual/live-DB checks,
but pytest collects them and imports `COACH_DB_URI` at module import time. Running
`.venv/bin/pytest -q` fails unless live DB env is present.

Fix:

- Rename manual files so pytest will not collect them, or
- Guard them with module-level skips when `COACH_DB_URI` is missing, or
- Move live checks under a separate integration test path with explicit markers.

Relevant files:

- `coach/smoke_test.py`
- `coach/e2e_test.py`

### Confirmation Flow Can Be Confused

The coach UI can still send a new message while a safety confirmation interrupt is
pending. That can desync the visible conversation from the backend checkpoint state.

Fix:

- Disable the message input and send button while `confirm` is non-null.
- Keep approve/decline as the only available actions until the interrupt resolves.
- Include the pending proposal details in the confirmation card, not only the reason.

Relevant file:

- `web/components/CoachView.tsx`

### RAG Grounding Needs Verification Beyond Retrieval

`answer()` retrieves chunks, asks the model to answer from them, then marks the result
as grounded and attaches citations for all retrieved sources. It does not prove the
model actually used those sources or that every claim is supported.

Fix:

- Require explicit citation markers in model output, then parse and validate them.
- Return only citations that were cited in the answer.
- Add a support check that downgrades to `grounded=false` if the answer introduces
  claims not present in the retrieved chunks.
- Add tests for "retrieved but unsupported answer" and "model ignores source" cases.

Relevant file:

- `coach/rag/answer.py`

### Runtime Configuration Is Drifting

The backend default moved toward `8010` in deployment and client code, but setup copy
and some docs still reference `8000`. The README also still describes the review
scheduler and RAG corpus as future work even though new deploy/RAG files exist.

Fix:

- Choose one local backend port for dev docs, setup defaults, and systemd notes.
- Update `.env.example`, README, and setup UI placeholders together.
- Document the LiteLLM embedding path and required env vars in the root quickstart.

Relevant files:

- `README.md`
- `.env.example`
- `web/app/settings/page.tsx`
- `web/lib/api.ts`
- `deploy/README.md`

## P2 - Product And Safety Improvements

### Safety Layer Needs A Second Line Of Defense

The deterministic safety layer is a good hard gate for known patterns, but it is still
keyword/regex based for inbound and outbound content screening.

Improve:

- Keep deterministic mutation gates as hard CI checks.
- Add a classifier or provider moderation pass for user and coach text.
- Keep clinician-reviewed copy and calorie thresholds outside prompt-only behavior.
- Expand tests with paraphrases, typos, and indirect unsafe requests.

Relevant files:

- `coach/safety.py`
- `coach/tests/test_safety.py`

### Review Scheduler Should Be Observable

The weekly review runner logs success/failure, but there is no in-app or operational
surface for "last review attempted" versus "last review completed."

Improve:

- Store batch run metadata separately from per-user review rows.
- Alert or expose status when repeated review runs fail.
- Consider per-user retry/backoff if one user's data or LLM call fails.

Relevant files:

- `coach/run_review.py`
- `coach/review.py`
- `deploy/systemd/coach-review.service`
- `deploy/systemd/coach-review.timer`

### RAG Corpus Lifecycle Needs A Clear Owner

The source fetch and ingest scripts are useful, but the process needs an explicit
operator workflow for reviewing extracted text before embedding.

Improve:

- Commit the source list, not fetched copyrighted text.
- Write fetched manifests to an ignored review path.
- Add a checklist for license, attribution, extraction quality, and review status.
- Record ingestion runs: model name, embedding dimension, corpus version, and row count.

Relevant files:

- `seed/rag_sources.json`
- `coach/rag/fetch_sources.py`
- `coach/rag/ingest_corpus.py`
- `coach/migrations/004_pgvector.sql`

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
- `.venv/bin/pytest -q`: failed during collection because manual smoke/e2e files import
  `COACH_DB_URI` before checking whether the live DB environment is configured.

## Recommended Fix Order

1. Make auth fail closed.
2. Fix pgvector upsert behavior and stale chunk cleanup.
3. Stop manual smoke/e2e files from breaking normal pytest collection.
4. Lock the coach UI while a confirmation interrupt is pending.
5. Normalize ports/config/docs.
6. Add RAG citation/support verification.
7. Add operational visibility for scheduled reviews and RAG ingestion.
