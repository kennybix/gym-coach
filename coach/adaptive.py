"""Adaptive calorie targets — a deterministic, system-owned energy-balance engine.

Roadmap Phase 2: "recompute weekly from logged intake + weight trend (MacroFactor-style),
clamped to the existing safety floors". This module is the *engine*: pure functions over
the user's own logs. No LLM anywhere in the compute path — the model may *explain* the
number (coach tool / weekly review) but never invents or writes it. The weekly review
applies an adjustment only when this engine says so, and only through the same safety
gate as every other target change.

How it works (all estimates, all conservative):

  observed maintenance  =  average logged intake  -  (weight slope kg/day x 7700)
      i.e. if you ate 2000 kcal/day and lost 0.5 kg/wk, you were burning ~2550/day.
  estimate              =  blend(observed, formula) weighted by how much data backs it
  suggested target      =  estimate - capped goal rate deficit, clamped to the floors,
                           dead-banded and step-limited against the current target.

Why the guards matter:
  * Under-logging is the failure mode. Missed meals make intake look low, which makes
    observed maintenance look low, which would push the target DOWN — exactly the wrong,
    unsafe direction. So thin logging => "insufficient", and an observed number far below
    the formula estimate => "underlogged" (hold), never a cut.
  * Sparse weigh-ins make the slope noise (see WeightTrend.sufficient); same bar here.
  * A change needs a stable window after the last change to be measurable (cooldown).
  * Eating-disorder history disables the engine entirely (returns `disabled`), matching
    the rest of the product.

Thresholds are documented constants — clinician-calibration placeholders, same status as
the floors in safety.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

from . import safety
from .models import Profile

# ---- data-sufficiency bar ------------------------------------------------------------
MIN_WEIGHINS = 4            # same bar as WeightTrend.sufficient
MIN_WEIGHT_SPAN_DAYS = 14   # "
MIN_LOGGED_DAYS = 10        # enough intake days for the average to mean something
MIN_LOG_COVERAGE = 0.5      # logged days / span days — below this, intake is not trustworthy

# ---- adjustment policy ------------------------------------------------------------------
DEAD_BAND_KCAL = 100        # smaller differences are noise; hold
MAX_STEP_FRACTION = 0.10    # never move the target more than ±10% in one review
COOLDOWN_DAYS = 14          # wait this long after any target change before adjusting again
UNDERLOG_RATIO = 0.75       # observed < 75% of formula => intake is almost certainly under-logged
ROUND_TO = 25               # targets are quoted to the nearest 25 kcal


Recommendation = Literal["disabled", "insufficient", "underlogged", "cooldown", "hold", "adjust"]


class AdaptiveEstimate(BaseModel):
    window_days: int
    recommendation: Recommendation
    # what the estimate is built on (so the coach/UI can show evidence, not just a number)
    days_logged: int = 0
    n_weighins: int = 0
    span_days: int = 0
    log_coverage: float = 0.0
    avg_intake_kcal: Optional[int] = None
    weight_rate_kg_per_week: Optional[float] = None
    # the estimates
    formula_maintenance_kcal: Optional[int] = None
    observed_maintenance_kcal: Optional[int] = None
    estimated_maintenance_kcal: Optional[int] = None
    confidence: Literal["none", "low", "medium", "high"] = "none"
    # the recommendation
    current_target_kcal: Optional[int] = None
    suggested_target_kcal: Optional[int] = None
    change_kcal: Optional[int] = None
    # human-readable: what's missing / why we hold / why we adjust
    needs: list[str] = []
    reason: str = ""


@dataclass
class _Slope:
    kg_per_day: float
    n: int
    span_days: int


def _linear_slope(points: list[tuple[float, float]]) -> Optional[float]:
    """Least-squares slope of y over x; None when it cannot be computed."""
    n = len(points)
    if n < 2:
        return None
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    sxx = sum((p[0] - mx) ** 2 for p in points)
    if sxx == 0:
        return None
    sxy = sum((p[0] - mx) * (p[1] - my) for p in points)
    return sxy / sxx


def weight_slope(series: list[dict]) -> _Slope:
    """`series` = [{date: 'YYYY-MM-DD', weight_kg: float}, ...] (daily-averaged points)."""
    pts = []
    for p in series:
        d = p["date"]
        day = date.fromisoformat(d) if isinstance(d, str) else d
        pts.append((float(day.toordinal()), float(p["weight_kg"])))
    if not pts:
        return _Slope(0.0, 0, 0)
    xs = [x for x, _ in pts]
    span = int(max(xs) - min(xs))
    s = _linear_slope(pts)
    return _Slope(s if s is not None else 0.0, len(pts), span)


def _round_to(x: float, step: int = ROUND_TO) -> int:
    return int(round(x / step) * step)


def compute_estimate(
    profile: Profile,
    weight_series: list[dict],
    nutrition_series: list[dict],
    current_target_kcal: Optional[int],
    current_target_since: Optional[datetime],
    latest_weight_kg: Optional[float],
    window_days: int = 28,
    today: Optional[date] = None,
) -> AdaptiveEstimate:
    """Pure function: the whole engine. Everything the coach/review/UI shows comes from here."""
    today = today or date.today()
    out = AdaptiveEstimate(window_days=window_days, recommendation="insufficient",
                           current_target_kcal=current_target_kcal)

    if "eating_disorder_history" in profile.medical_flags:
        out.recommendation = "disabled"
        out.reason = "Automated calorie targets are disabled for this user."
        return out

    # --- formula anchor (Mifflin-St Jeor x activity), when we have a weight at all ---------
    if latest_weight_kg:
        out.formula_maintenance_kcal = safety.estimate_maintenance(profile, latest_weight_kg)

    # --- the evidence ----------------------------------------------------------------------
    intake_days = [d for d in nutrition_series if d.get("kcal") is not None and d["kcal"] > 0]
    out.days_logged = len(intake_days)
    sl = weight_slope(weight_series)
    out.n_weighins, out.span_days = sl.n, sl.span_days
    if intake_days:
        out.avg_intake_kcal = int(round(sum(d["kcal"] for d in intake_days) / len(intake_days)))
    if sl.n >= 2 and sl.span_days > 0:
        out.weight_rate_kg_per_week = round(sl.kg_per_day * 7, 2)
    # coverage: logged days over the weigh-in span (the period the slope describes)
    denom = max(sl.span_days + 1, 1)
    out.log_coverage = round(min(1.0, out.days_logged / denom), 2) if sl.n else 0.0

    needs: list[str] = []
    if sl.n < MIN_WEIGHINS:
        needs.append(f"{MIN_WEIGHINS - sl.n} more weigh-in{'s' if MIN_WEIGHINS - sl.n != 1 else ''}")
    elif sl.span_days < MIN_WEIGHT_SPAN_DAYS:  # only worth saying once there are enough weigh-ins
        needs.append(f"weigh-ins spread over {MIN_WEIGHT_SPAN_DAYS}+ days (currently {sl.span_days})")
    if out.days_logged < MIN_LOGGED_DAYS:
        k = MIN_LOGGED_DAYS - out.days_logged
        needs.append(f"food logged on {k} more day{'s' if k != 1 else ''}")
    elif sl.n >= MIN_WEIGHINS and out.log_coverage < MIN_LOG_COVERAGE:
        needs.append("food logged on most days between weigh-ins")
    out.needs = needs
    if needs:
        out.recommendation = "insufficient"
        out.reason = "Not enough logged data yet to estimate your real maintenance reliably."
        # still surface the formula anchor as the (only) estimate, clearly low-confidence
        out.estimated_maintenance_kcal = out.formula_maintenance_kcal
        out.confidence = "low" if out.formula_maintenance_kcal else "none"
        return out

    # --- observed maintenance --------------------------------------------------------------
    # weight slope kg/day x 7700 kcal/kg = daily energy stored (+) or released (-)
    observed = out.avg_intake_kcal - sl.kg_per_day * safety.KCAL_PER_KG
    out.observed_maintenance_kcal = int(round(observed))

    # --- under-logging guard ---------------------------------------------------------------
    formula = out.formula_maintenance_kcal
    if formula and observed < formula * UNDERLOG_RATIO:
        out.recommendation = "underlogged"
        out.estimated_maintenance_kcal = formula
        out.confidence = "low"
        out.reason = (
            "Logged intake looks far below what the weight trend implies you burn — this "
            "usually means some meals weren't logged. Holding the target; log everything for "
            "a couple of weeks and the estimate will firm up."
        )
        return out

    # --- blend observed with the formula, weighted by how much data backs the observation ---
    # weight grows with span (up to the window) and logging coverage; at a full, well-logged
    # window the observed number dominates.
    w = min(1.0, sl.span_days / window_days) * out.log_coverage
    w = max(0.5, min(0.9, w)) if formula else 1.0
    estimate = w * observed + (1 - w) * (formula or observed)
    out.estimated_maintenance_kcal = int(round(estimate))
    out.confidence = "high" if (sl.span_days >= window_days - 2 and out.log_coverage >= 0.8) \
        else "medium" if (sl.span_days >= 21 and out.log_coverage >= 0.6) else "low"

    # --- suggested target: estimate minus the CAPPED goal-rate deficit, floored -------------
    rate = min(max(profile.weekly_rate_kg, 0.0), safety.MAX_SAFE_WEEKLY_RATE_KG)
    target = estimate - rate * safety.KCAL_PER_KG / 7
    floor = safety.ABSOLUTE_KCAL_FLOOR.get(profile.sex.value, 1200)
    target = max(target, floor)

    if current_target_kcal is None:
        # No target to adjust (never onboarded a target) — just report the estimate.
        out.suggested_target_kcal = _round_to(target)
        out.recommendation = "hold"
        out.reason = "No active target to adjust; estimate shown for reference."
        return out

    # step-limit against the current target, then round
    lo = current_target_kcal * (1 - MAX_STEP_FRACTION)
    hi = current_target_kcal * (1 + MAX_STEP_FRACTION)
    stepped = max(lo, min(hi, target))
    stepped = max(stepped, floor)
    suggested = _round_to(stepped)
    change = suggested - current_target_kcal
    out.suggested_target_kcal = suggested
    out.change_kcal = change

    if abs(change) < DEAD_BAND_KCAL:
        out.suggested_target_kcal = current_target_kcal
        out.change_kcal = 0
        out.recommendation = "hold"
        out.reason = "Your target already matches what your logs show; no change needed."
        return out

    if current_target_since is not None:
        since = current_target_since.date() if isinstance(current_target_since, datetime) else current_target_since
        age = (today - since).days
        if age < COOLDOWN_DAYS:
            out.recommendation = "cooldown"
            out.reason = (f"Target changed {age} day{'s' if age != 1 else ''} ago; giving it "
                          f"{COOLDOWN_DAYS} days to show in the trend before adjusting again.")
            return out

    out.recommendation = "adjust"
    direction = "up" if change > 0 else "down"
    rate_txt = f"{abs(out.weight_rate_kg_per_week):.2f} kg/wk" if out.weight_rate_kg_per_week is not None else "n/a"
    trend_word = "losing" if (out.weight_rate_kg_per_week or 0) < 0 else "gaining"
    out.reason = (
        f"Over {sl.span_days} days you logged ~{out.avg_intake_kcal} kcal/day on {out.days_logged} days "
        f"and were {trend_word} about {rate_txt}, which puts maintenance near "
        f"{out.estimated_maintenance_kcal} kcal/day. For your {rate:.2f} kg/wk goal that means "
        f"moving the target {direction} to {suggested} kcal ({'+' if change > 0 else ''}{change})."
    )
    return out


def rationale_for(est: AdaptiveEstimate) -> str:
    """The append-only `targets.rationale` text for an engine-driven change."""
    return "Adaptive (energy-balance) weekly adjustment: " + est.reason
