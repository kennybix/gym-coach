# Safety thresholds — clinician sign-off checklist

> **What this is.** The numeric guardrails in `coach/safety.py` have been *evidence-aligned*
> to published general-population guidance (sources below). That is **not** a substitute for
> review by a qualified clinician. This checklist exists so a licensed professional can
> confirm (or adjust) each value for the intended user/population and **sign off before any
> real-world use.** The app is a personal training aid, not a medical device.

## How the guardrails work (context for the reviewer)
- **The model never sets these.** Floors/caps live in code (`safety.py`), enforced by the
  `safety` graph node; a jailbroken prompt cannot push past them.
- **Eating-disorder history disables automated calorie targets entirely** — onboarding
  creates no target and the coach refuses target changes on that path. Confirm this is the
  desired behaviour.
- **Content screening** routes disordered-eating / self-harm / extreme-deficit / numeric
  very-low-calorie / rapid-loss-intent / train-through-injury signals to a supportive
  redirect, never to optimized advice.
- **Vitals**: the coach comments on BP/HR freely (per operator choice) with a prompt-level
  nudge to seek professional care for clearly dangerous readings. There is **no hard vitals
  guardrail** — review whether one is wanted.

## Thresholds to review

| Constant | Current value | Evidence basis | Reviewer: confirm / adjust | Initials |
|---|---|---|---|---|
| `ABSOLUTE_KCAL_FLOOR` (female / other) | 1200 kcal/day | NHS/Harvard: don't go below ~1200 (women) without supervision | | |
| `ABSOLUTE_KCAL_FLOOR` (male) | 1500 kcal/day | …~1500 (men) without supervision | | |
| `MAX_SAFE_WEEKLY_RATE_KG` | 1.0 kg/week | CDC/NHS: gradual 0.5–1 kg (1–2 lb)/week | | |
| `CONFIRM_CUT_BAND` | 0.85 (>15% cut → confirm) | Conservative single-step heuristic | | |
| `REJECT_STEP_CUT_BAND` | 0.75 (>25% single-step → reject) | Conservative single-step heuristic | | |
| `MIN_PROTEIN_G` / `MAX_PROTEIN_G` | 0 / 400 g | Plausibility bounds only | | |
| `estimate_initial_target` constants | Mifflin-St Jeor + activity ×, capped to floor | Standard BMR estimate | | |

## Operational
- `COACH_SUPPORT_RESOURCE` must be set to a **current, region-correct, clinician-reviewed**
  eating-disorder support resource. Do **not** hardcode a national helpline (e.g. the
  discontinued NEDA line). Confirm the configured value: ____________________
- Crisis/redirect copy (`safety.REDIRECTS`) is numberless and appearance-neutral — review wording.

## Sign-off
- Reviewer (name, credentials): ________________________________________
- Date: ____________   Population/intended user reviewed for: ____________________
- [ ] Thresholds confirmed or adjusted as noted above
- [ ] Screening categories + redirect copy reviewed
- [ ] Support resource is current and region-appropriate
- [ ] Approved for the stated use, OR changes required (note): ____________________

## Sources
- CDC — Steps for Losing Weight / Healthy Weight (gradual 1–2 lb per week)
- NHS — Weight-loss guidance (0.5–1 kg per week; ~600 kcal deficit) and Very Low Calorie Diets
- Harvard Health — calorie-counting / minimum-intake guidance
- (General-population guidance; not a substitute for individualized clinical judgement.)
