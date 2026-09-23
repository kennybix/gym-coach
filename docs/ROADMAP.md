# Gym Coach — Improvement Roadmap

**Status at 2026-09-22:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 mostly shipped · Phase 4 (UI
redesign) ✅ · Phase 5 (reliability and re-engagement) ✅. What's actually left is
short: **import/restore**, **repeat-last-workout**, **rest-timer notifications**, and the
pre-launch items (clinician sign-off, always-on hosting). Screen-by-screen UI decisions live in
[`SYSTEM_OVERVIEW.md` §8](SYSTEM_OVERVIEW.md) and the UI invariants in [`../CLAUDE.md`](../CLAUDE.md).

Living plan for the next phases. Synthesizes two independent 2026-06-06 reviews —
[`competitive-review-2026-06-06.md`](competitive-review-2026-06-06.md) and
[`product-capability-review-2026-06-06.md`](product-capability-review-2026-06-06.md) — which
converged strongly. Read those for evidence; this is the *what-next*.

## North star (positioning — both reviews agreed verbatim)

> **A private AI coach over your own data** — training + food + weight + vitals + weekly review
> + safe, conservative plan adjustment, without handing your data to a fitness platform.

**Not** "a better workout logger." Don't fight Hevy/Strong/Fitbod on logger maturity. Compete on
the wedge they can't easily copy: **log-grounded coaching, deterministic safety, and all-in-one
integration over private data.** Every phase should either *amplify that wedge* or *remove
friction that blocks the daily loop* — not chase feature parity for its own sake.

## Where we are (convergent findings)

- **Strengths:** in-gym Today loop; AI coach that reads real logs and proposes via a safety gate;
  wellbeing-first/ED-aware framing; cited knowledge; privacy/ownership/ad-free; integrated vitals.
- **Table-stakes gaps:** lifting analytics (PR/1RM/volume/progression); set metadata
  (RPE/tags/supersets); Health/wearable sync; nutrition depth; native polish; import/restore.
- **Trust gaps (cheap, high-value):** the coach doesn't *show its evidence*; trends make
  dramatic claims from sparse data (e.g. "15.9 kg/wk" off ~2 weigh-ins).

## Guardrails that constrain every change (do not break)

- **LLM proposes, system disposes** — new "engines" (progression, targets) must be *deterministic
  and system-owned*; the model explains/proposes, never writes. New write endpoints stay idempotent.
- **`targets` is append-only**; express changes as new rows with rationale.
- **Safety/wellbeing invariants** (calorie floors, ED-history target block, no calorie verdicts,
  content screening) — preserved and, where relevant, extended (e.g. sparse-data caution).
- **Coach optional at startup** — analytics/UI must work with the LLM off.

---

# Phase 1 — "A coach you can trust, fed by real lifting signal"  ✅ SHIPPED 2026-06-06

All items below shipped: A1 sparse-data caution, B1 RPE/set-type, B2 PR+est-1RM, B3 per-exercise
progression view, B4 deterministic next-load suggestion, A2 coach evidence panel, A3 proposal diffs.


The two halves reinforce: richer logged signal (RPE, PRs, progression) → better, more concrete
coach evidence. Ship in the order below; each item lists acceptance criteria.

## Group A — Coach trust (cheap, amplifies the differentiator)

### A1. Sparse-data trend caution  *(quickest; fixes a visible issue)*
- Don't show a weight rate (kg/wk) unless **≥4 weigh-ins spanning ≥14 days**; otherwise show
  "Not enough data yet — a few more weigh-ins and I'll show a reliable trend." Label any shown
  rate with a confidence/period (e.g. "≈0.4 kg/wk over 21d, 6 readings").
- Backend `get_weight_trend` returns `{rate, n, span_days, sufficient, confidence}`; the coach
  tool surfaces these so the model *hedges* when thin instead of asserting.
- **Done when:** the Trends card and coach never state a weekly rate from <4 readings; sparse
  state shows the calmer copy.

### A2. Coach evidence panel
- Every coach reply/insight/review that makes a data claim renders a compact **"Based on:"** chip
  row — e.g. `weight 84.1→83.2 kg · 14d · 5 logs` · `adherence 3/4` · `protein 95/130 g avg`.
- Implementation: the agent emits a structured `evidence: [{label, value, period}]` alongside the
  reply (populated from the tool results it already fetches); render under the message.
- **Done when:** coach messages that cite data show the exact figures + dates that backed them.

### A3. Before/after diffs on proposals
- The confirm card for a proposed target/program/equipment change shows **old → new** explicitly
  (`Daily protein 130 → 145 g`; `Back Squat 3×8 → 3×6 @ +2.5 kg`).
- Backend includes the current value in the staged proposal payload; UI renders the diff.
- **Done when:** no proposal is confirmed without the user seeing exactly what changes.

### A4. Change history  *(if time)*
- A "What the coach changed" timeline (targets are already append-only; program versions kept).
- **Done when:** Setup/Coach shows a dated list of committed coach changes with rationale.

## Group B — Lifter analytics (table-stakes that also feed the coach)

### B1. Set metadata: RPE/RIR + set-type tags
- `set_logs.rpe` already exists; add `set_type` (normal/warmup/drop/failure). Expose **optional,
  unobtrusive** RPE + type in the logging UI (don't clutter the one-tap path).
- **Done when:** a set can carry RPE + type; history/export include them; coach tools can read RPE.

### B2. PR detection + estimated 1RM
- Per exercise compute **best set**, **weight PR**, **rep PR**, **estimated-1RM PR** (Epley:
  `w*(1+reps/30)`). Detect at log time → return a `pr` flag → celebrate in-UI (small, non-gamified).
- **Done when:** logging a top set surfaces "New best — est. 1RM 92 kg" and PRs persist per exercise.

### B3. Per-exercise progression view
- Tap an exercise → detail with **e1RM over time**, **volume** (Σ sets×reps×weight), best set,
  total reps; reuse the responsive chart component. New endpoint `/api/exercise/{id}/stats`.
- **Done when:** each exercise has a trend view a lifter would recognize.

### B4. Deterministic next-load suggestion  *(the progression-engine seed)*
- From last session + RPE: suggest next target (all reps hit at RPE ≤8 → +smallest increment;
  missed → hold; RPE ≥9.5 repeatedly → deload). **System computes; the SlotCard prefills it; the
  coach explains it.** No LLM in the compute path.
- **Done when:** the SlotCard shows a suggested target ("Target 62.5 kg") with a one-line why, and
  the coach can reference the same number.

**Phase-1 sequence:** A1 → B1 → B2 → B3 → B4 → A2 → A3 → (A4). Each is independently shippable.

---

# Phase 2 — Kill manual friction + deepen nutrition

**Status (2026-09-12):** all three items shipped — Health Connect sync via the Capacitor Android
shell (weight/BP/resting HR), **adaptive calorie targets** (`coach/adaptive.py`, 2026-09-12: a
deterministic energy-balance engine — observed maintenance from logged intake + weight slope,
blended with the formula anchor, floored/step-capped/dead-banded/cooled-down; the weekly review
applies ONLY its verdict through the safety gate, the coach explains it via
`get_adaptive_target_estimate`, Trends shows the maintenance estimate + what's still needed, never
a target number), and nutrition depth (full macros, saved meals, photo logging).

- **Health/wearable import** (Apple Health / Health Connect: weight, HR, steps, workouts). ⚠️
  **Architectural decision:** a PWA cannot read these — needs a **native shell** (Capacitor or a
  TWA + companion). Decide shell strategy here; biggest friction-killer once solved.
- **Adaptive calorie targets (TDEE)** — recompute weekly from logged intake + weight trend
  (MacroFactor-style), clamped to the existing safety floors; pairs with the no-shame framing.
- **Nutrition depth (selective):** full macros (carbs/fat/fiber), saved meals + favorites, better
  recent-food defaults, robust offline/error handling. Don't try to out-DB MyFitnessPal.

# Phase 3 — Programming, retention, distribution  *(mostly shipped)*

**Programming**
- ✅ Templates/routines library — six curated templates plus coach-designed-from-a-goal, each
  reviewable before install (`coach/programs.py`, `ProgramsLibrary`).
- ✅ Multiple routines in parallel, each with its own weekday schedule; Home shows only what's
  scheduled today.
- ✅ Drag-to-reorder program editor; per-exercise sets × reps inline.
- ⬜ **"Repeat last workout"** — the player prefills from the last logged set per exercise, but
  there's no one-tap "do last session again" entry point.
- ⬜ **Progression blocks / deloads** — B4's next-load suggestion exists per lift; block
  periodisation and scheduled deloads do not.

**Trust / portability**
- ✅ Export (JSON + per-dataset CSV) and a nightly `pg_dump` with rotation + a restore drill.
- ⬜ **Import/restore in the app** — the missing half of the data-ownership story, and the
  highest-value item left on this list.

**Native + retention**
- ✅ Packaged Android app (Capacitor) with Health Connect import, camera, and local notifications.
- ✅ Daily reminders (calm, opt-in, per-time) and a food-logging streak strip.
- ✅ Haptics on logging a set, finishing a workout, saving a sheet, switching looks.
- ✅ Install guidance ([`deploy/PHONE_ACCESS.md`](../deploy/PHONE_ACCESS.md)) + a device smoke
  checklist ([`deploy/DEVICE_SMOKE.md`](../deploy/DEVICE_SMOKE.md)).
- ⬜ **Rest-timer notifications** — the timer is in-app only; it doesn't fire a notification if
  you leave the app mid-rest.
- ⬜ Widgets; later Watch / Wear OS.

---

# Phase 5 — Reliability and re-engagement  ✅ SHIPPED 2026-09-22

A review after ten days of unattended running found the product dormant for reasons no test
caught: the phone was **locked out** (a secret rotation, and re-pasting a JWT by hand was the only
way back), the **coach was down for days** (one model in a 128-hour provider cooldown, the weekly
review crashing silently), the phone was running a **two-month-old bundled UI**, and **nothing ever
reached out** — four straight reviews said *insufficient data*.

- ✅ **QR pairing** — `python pair.py` + **Scan pairing code** in the app (Home, Setup, the
  signed-out banner) and a `/pair` page for the camera path.
- ✅ **Model failover** — `COACH_MODELS` chain with cooldown memory, function-calling structured
  output, `/coach/status`, and "offline until about Thursday" instead of "try again shortly".
- ✅ **Self-healing jobs** — the review timer runs daily with `--if-missing`; `OnFailure=` pushes an
  alert; stale open sessions are closed nightly.
- ✅ **The server reaches the phone** — self-hosted ntfy on the tailnet: the weekly review, a calm
  morning nudge (never a weigh-in prompt for ED history; Mondays only after 14 quiet days).
- ✅ **Two-tap logging** — the Android app loads the live site (no more stale bundles), with
  `gymcoach://` deep links, home-screen shortcuts, notification taps onto the right sheet, silent
  Health Connect sync, and an offline page.

**Still open here:** the active program is 16 exercises / ~100 minutes, every day — a likely reason
sessions don't start. Worth a coach-assisted rethink (shorter default sessions, or split days).

---

# Phase 4 — The UI redesign  ✅ SHIPPED 2026-09-12

Not in the original plan; it came out of a full screen-by-screen critique that found the app was
"a competent logger wearing a dark-mode template" — every screen a scroll of identical cards,
most of them permanently-open forms, with zero-states as the loudest thing on the page.

- ✅ **Five user-selectable looks** (Volt, Paper, Ember, Glacier, Mono, + Auto) as CSS-variable
  blocks on `<html data-theme>`, stamped before first paint. A look is a palette swap, not a
  re-skin — which is only possible because every component reads tokens.
- ✅ **A real type scale** (Bricolage Grotesque / IBM Plex Sans / IBM Plex Mono) and one lifted
  object per screen instead of uniform cards.
- ✅ **Home** replaces the old Today list: the day, not the database.
- ✅ **Workout player** — one exercise at a time, rest timer owns the screen, finish summary.
- ✅ **Progress / Food / Coach / Train** rebuilt; **all logging moved into bottom sheets**.
- ✅ **Coach** got an identity, verdict-first reviews, suggested prompts, prose replies.
- ✅ **Onboarding** rebuilt to match, and Home now routes a fresh token into it.

---

## Explicitly deferred / non-goals (for now)

- Social feed / challenges / trainer marketplace (off-strategy; retention via the coach instead).
- Beating MyFitnessPal on food-DB scale (capture *enough* signal for coaching, not parity).
- GPS/HR-zone cardio (Strava territory) until wearable sync exists.
- Multi-tenant auth/billing (POC sets this aside per current scope).

## Success criteria for "I'd pay for it" (from the reviews)

| Criterion | State |
|---|---|
| Reliable one-handed logging | ✅ workout player, sheets, offline queue |
| PR / 1RM / volume analytics | ✅ B2/B3 |
| Transparent coach evidence | ✅ A2/A3 evidence chips + proposal diffs |
| Health import | ✅ Health Connect (native shell) |
| Stronger progression | 🟡 per-lift next-load suggestion; no blocks/deloads |
| Better food defaults | ✅ recents, saved meals, barcode, photo |
| Import/restore | ⬜ **the one gap left** |
| Feels like a product, not a logger | ✅ the Phase 4 redesign |
