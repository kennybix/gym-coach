# Gym Coach — Honest Feature & Competitive Review (2026-06-06)

Scope per request: **features and capabilities only.** Auth/single-user/self-hosted POC
limitations are set aside — this judges *what the product does*, not how it's deployed.
Grounded in the actual codebase (endpoints, components, catalog, RAG) and benchmarked against
current Play/App Store apps (sources at the end).

---

## Verdict (the honest one-paragraph)

Gym Coach is **architecturally ahead of the market on the things that are hard and rare, and
behind it on the things that are merely laborious.** Its AI coach is genuinely good — it reads
your *real* logs before it advises, proposes changes through a deterministic safety gate, and
is built wellbeing-first (no calorie shaming, eating-disorder-aware). That combination —
**grounded + safe + all-in-one (lifting + cardio + nutrition + vitals + coach) + private/ad-free**
— does not exist in a single shipping app today. But on the table-stakes depth that dedicated
apps have spent 5-10 years perfecting — exercise *video* instruction, logging richness
(supersets, RPE, PRs, auto-progression), food-database breadth, adaptive calorie targets, and
wearable sync — it is clearly a step or two behind. **The differentiation is real but the moat
is narrow:** the incumbents are bolting on AI (Hevy Trainer, Fitbod), and a new LLM-coach
category (Bloom, WHOOP Coach, Zing) is racing at the same conversational-coach vision. The
durable edges are the **safety architecture** and the **integration breadth**, not the chat itself.

---

## What the app actually does (grounded inventory)

| Area | Capability |
|---|---|
| **Strength logging** | Start/finish session; log sets as typed weight×reps; edit/remove a set in place; ad-hoc exercises; 90s rest timer; workout history (browse + fix old logs) |
| **Cardio logging** | Time + distance for cardio exercises (treadmill, bike, rower, …) — separate from sets/reps |
| **Exercise catalog** | 873 exercises (free-exercise-db): 581 strength, 123 stretching, 61 plyo, 38 powerlifting, 35 olympic, 21 strongman, 14 cardio. Equipment variants, text form cues, **2-frame cross-fade animations** |
| **Program** | Build/reorder/retarget (sets×reps) or mark cardio; replaces active program, keeps old versions for history |
| **Nutrition** | Open Food Facts search + **barcode scan** + recent foods; grams or servings; macro summary (protein as a goal, calories shown **without** over/under verdicts); manual totals; per-day edit; streak |
| **Body & vitals** | Weight with tap-a-point-to-edit chart + trend; **blood pressure + heart rate** (many/day, tags, notes, sparklines) — coach-readable |
| **AI coach** | Chat grounded in real data (`get_weight_trend`, `get_adherence`, `get_nutrition_summary`, `get_current_targets`, `get_recent_vitals`); proposes target/program/equipment changes via `propose_*` → safety → commit; multi-chat history; **proactive insights**; **weekly review** (scheduled) |
| **Knowledge** | Cited Q&A over a 257-chunk RAG corpus (CDC/NHS/MedlinePlus/OpenStax), governance-gated |
| **Safety** | Deterministic calorie floors, goal-rate caps, **ED-history disables auto targets**, inbound/outbound content screening (disordered-eating/self-harm/extreme-deficit/injury), region-set crisis redirects |
| **Platform** | Installable PWA, offline write-queue (idempotent), data export (JSON + per-dataset CSV), onboarding wizard |

---

## Where it's genuinely strong (and why it's rare)

1. **Safety-by-architecture — best-in-class, evidence-backed.** Calorie floors and goal-rate
   caps live in *code*, not the prompt; eating-disorder history disables automated targets
   entirely; content screening routes risky signals to support. This matters: a 2025 Flinders
   University review of 38 studies found diet/fitness apps can harm at-risk users, and **~30% of
   surveyed users said MyFitnessPal significantly contributed to an eating disorder**, with guilt
   driven by "over budget" red visualizations and gamified under-eating. **Almost no mainstream
   tracker is built to actively prevent this.** MacroFactor matches the *tone* (adherence-neutral,
   no shame), but Gym Coach goes further with hard, deterministic guardrails an LLM cannot override.

2. **An AI coach grounded in your actual data.** The coach calls read-tools to pull your real
   weight trend, adherence, nutrition, and vitals *before* it claims anything, and it can only
   *propose* changes — the system commits them. Most "AI coach" apps are either ChatGPT wrappers
   that hallucinate, or don't see your logs at all. This is the right architecture, and it's ahead
   of most of the field.

3. **All-in-one integration.** Lifting + cardio + nutrition + **vitals** + conversational coach in
   one app. The market is fragmented — Hevy/Strong own lifting, MyFitnessPal/MacroFactor own food,
   Strava owns cardio. Vitals (BP/HR) feeding the coach is essentially unheard of in fitness apps.

4. **Cited, vetted knowledge (RAG).** Answers from CDC/NHS/MedlinePlus/OpenStax with citations and
   a governance gate. The LLM-coach category is notorious for confident hallucination; citing
   openly-licensed medical sources is a real trust edge.

5. **Privacy & ownership.** Ad-free, no data-selling, full export. MyFitnessPal's free tier is
   ad-heavy and paywalled the *barcode scanner* in 2022; this app's posture is the opposite.

---

## Where it's behind / missing (the honest gaps)

1. **Exercise instruction is thin.** 2-frame cross-fade "animations" + text cues vs **Hevy and
   Fitbod's 1,000+ exercises with free HD video demonstrations.** For a beginner who "only sees
   names," static gifs help but don't match a real demo. *Biggest perceived-quality gap.*
2. **Logging depth is shallow.** No **supersets**, no **RPE/RIR logging**, no **PR/1RM tracking
   or per-exercise progression charts**, no warmup/drop/failure set types, no plate calculator.
   Hevy/Strong do all of this; Hevy even auto-celebrates PRs mid-set.
3. **No automated programming.** The coach can *propose* changes, but there's no
   workout *generation* from goals/equipment, no periodization, and no muscle-fatigue/recovery
   model. **Fitbod's entire product** is fatigue-aware generation + auto progressive-overload;
   **Hevy Trainer (Feb 2026)** auto-progresses weight session-to-session. Gym Coach has the
   conversational hooks but not the systematic engine.
4. **Static calorie targets.** Targets come from onboarding/coach and don't adapt. **MacroFactor's
   killer feature is an adaptive TDEE** that recalculates weekly from your actual weight + intake.
   This pairs perfectly with the wellbeing framing and is a notable miss.
5. **No wearable / Health-platform sync.** No Apple Health, Google Fit, Garmin, or smart-scale
   integration. This is the **biggest practical friction**: every weight, vital, and cardio
   session is hand-entered, while competitors auto-import. Highest-ROI gap to close.
6. **Food database breadth + tooling.** Open Food Facts is crowd-sourced and thinner on US
   branded/restaurant items than MyFitnessPal's 14M entries; no recipe builder, saved meals,
   quick-add, meal-photo scan, or micronutrients (Cronometer/MacroFactor track vitamins/minerals).
7. **Cardio is minimal.** Time + distance only — no GPS route, pace/splits, or HR zones (Strava /
   Nike Run Club / Garmin territory).
8. **No social / accountability / gamification.** No feed, friends, challenges, or streaks beyond
   nutrition. This is a primary *retention* engine for Hevy and Strava.
9. **No body measurements or progress photos.** Only weight + vitals; competitors track
   waist/arms/etc. and photo timelines.

---

## Competitive landscape

| App | Core strength | Has AI coach? | Safety/wellbeing | Price (2026) |
|---|---|---|---|---|
| **Gym Coach** | Grounded AI coach + safety + all-in-one + vitals + privacy | **Yes — grounded + safe** | **Best-in-class (deterministic, ED-aware)** | Self-hosted / free |
| **Hevy** | Best lifting logger: 1,000+ w/ video, supersets, RPE, auto-PRs, social; Trainer auto-progresses | Emerging (Trainer, 2026) | Neutral | Free; Pro $5.99/mo, $34.99/yr |
| **Fitbod** | Fatigue-aware AI workout *generation* + progressive overload + HD videos | Algorithmic (not chat) | Neutral | $15.99/mo, $95.99/yr |
| **MacroFactor** | Adaptive TDEE nutrition coaching + micros + **no-shame design** | Algorithmic | **Strong (adherence-neutral)** | $11.99/mo → $5.99/mo annual |
| **MyFitnessPal** | Largest food DB (14M) + barcode + recipes | Meal-scan AI only | **Poor (linked to ED harm)** | Free (ads); Premium $79.99/yr |
| **LLM-coach wave** (Bloom/Beebo, WHOOP Coach, Zing, BodBot) | Conversational, adaptive plans | **Yes (their whole pitch)** | Varies; mostly ungrounded | Varies |

**The two pincers on Gym Coach's differentiation:** incumbents are adding AI (Hevy Trainer,
Fitbod), and a dedicated LLM-coach category is forming. Notably, the academic Bloom/Beebo coach
(ACM CHI 2026 best paper) converged on the *same* design principles Gym Coach already follows —
facilitative, nonprescriptive, nonjudgmental, tailored to the person. The idea is validated and
contested at once. Gym Coach's edges that the wave *doesn't* have: **deterministic safety
guardrails, log-grounded tool calls, and integrated vitals.**

---

## Honest scorecard (vs best-in-class = 5)

| Capability | Score | Note |
|---|---|---|
| AI coaching (grounded, conversational) | **4.0** | Ahead of most; real data + propose→commit |
| Safety & wellbeing | **5.0** | Rare, evidence-aligned, deterministic |
| Privacy / ownership / ad-free | **5.0** | Self-hosted, full export |
| Vitals / health integration | **4.0** | BP/HR + coach access — uncommon |
| Knowledge / education (cited) | **4.0** | RAG with citations |
| Nutrition logging | **3.0** | Barcode + macros, but thinner DB, no recipes/meals/micros |
| Strength logging | **2.5** | Solid basics; no supersets/RPE/PR/progression |
| Nutrition targets (adaptive) | **2.5** | Static — no adaptive TDEE |
| Programming intelligence | **2.0** | Proposes, doesn't generate/periodize |
| Exercise instruction | **2.0** | 2-frame gifs + text vs HD video |
| Cardio | **1.5** | Time/distance only |
| Wearable / automation | **0.5** | None — biggest practical gap |

---

## What it would take to be competitive (priority order)

1. **Wearable / Health-platform sync** (Apple Health, Google Fit, Garmin, smart scales).
   Kills the manual-entry friction that defines the daily experience. Highest ROI.
2. **Logging depth**: RPE/RIR, automatic **PR/1RM tracking + per-exercise progression charts**,
   supersets, plate calculator. This is what makes lifters *stay*.
3. **Adaptive calorie targets** (TDEE that recalculates from weight + intake). Natural pairing
   with the existing no-shame framing; closes the gap to MacroFactor.
4. **Real exercise instruction** (video or richer media + better cue presentation).
5. **Make the coach a programmer**: it already proposes changes — let it *systematically*
   progress load and structure mesocycles (the engine Fitbod/Hevy Trainer have).
6. Then breadth: recipe/meal tooling + micronutrients, cardio depth (GPS/HR), body
   measurements + progress photos, and (for retention) light social/accountability.

**Bottom line:** as a POC, the *coaching brain and safety spine* are genuinely differentiated
and arguably best-in-class. To be a product people choose over Hevy + MacroFactor, it needs the
unglamorous depth — sync, logging richness, adaptive targets, and exercise media — that those
apps have spent years building. The strategy that plays to its strengths is **"the safe,
private, all-in-one coach"**, not **"a better workout logger."**

---

## Sources
- [Hevy — features](https://www.hevyapp.com/features/) · [pricing](https://hevy.com/pricing) · [review (PRPath, 2026)](https://prpath.app/blog/hevy-app-review-2026.html)
- [Fitbod — site](https://www.fitbodapp.com/) · [algorithm](https://fitbod.me/blog/fitbod-algorithm/) · [review (Indie Hackers, 2026)](https://www.indiehackers.com/post/fitbod-app-review-2026-honest-take-after-real-testing-45d5f07a1b)
- [MacroFactor — site](https://macrofactor.com/macrofactor/) · [pricing/review (Arvo, 2026)](https://arvo.guru/vs/macrofactor)
- [MyFitnessPal — Premium features](https://support.myfitnesspal.com/hc/en-us/articles/360032625951) · [review (calorie-trackers, 2026)](https://calorie-trackers.com/reviews/myfitnesspal/)
- LLM coaches: [Bloom/Beebo (Stanford HAI, CHI 2026)](https://hai.stanford.edu/news/an-ai-health-coach-could-change-your-mindset) · [Best AI trainer apps 2026 (Ray)](https://www.rayfit.com/blog/2026/02/best-ai-personal-trainer-app/)
- ED safety: [Fitness apps & disordered eating (Flinders/EurekAlert, 2025)](https://www.eurekalert.org/news-releases/1074348) · [Cybernews summary](https://cybernews.com/tech/health-fitness-apps-eating-disorder-symptoms/) · [MFP & EDs (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5700836/)
