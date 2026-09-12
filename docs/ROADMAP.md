# Gym Coach — Improvement Roadmap

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

# Phase 3 — Programming, retention, distribution

- **Programming:** templates/routines library, "repeat last workout", multiple routines, optional
  progression blocks/deloads building on B4.
- **Trust/portability:** import/restore (completes the export story).
- **Native + retention:** packaged app (TWA/Capacitor), rest-timer **notifications**, install
  guidance, haptics, widgets; later Watch/Wear OS. Light accountability (streaks/reminders) — keep
  it calm, no social-comparison pressure (consistent with the wellbeing stance).

---

## Explicitly deferred / non-goals (for now)

- Social feed / challenges / trainer marketplace (off-strategy; retention via the coach instead).
- Beating MyFitnessPal on food-DB scale (capture *enough* signal for coaching, not parity).
- GPS/HR-zone cardio (Strava territory) until wearable sync exists.
- Multi-tenant auth/billing (POC sets this aside per current scope).

## Success criteria for "I'd pay for it" (from the reviews)

Reliable one-handed logging ✓ (mostly there) · PR/1RM/volume analytics (B2/B3) · transparent
coach evidence (A2/A3) · Health import (P2) · stronger progression (B4→P3) · better food defaults
(P2) · import/restore (P3). Phase 1 delivers the analytics + transparency half of that list.
