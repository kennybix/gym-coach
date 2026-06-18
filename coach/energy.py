"""Deterministic energy estimates for duration-based activity (cardio + sports).

kcal = MET x bodyweight(kg) x duration(hours). MET values are approximate, from the
Compendium of Physical Activities. These are *estimates* — the UI and coach must call them
that. Strength sets (no duration) are not estimated here. System-computed, never the LLM.
"""
from __future__ import annotations

# substring (lowercased exercise/activity name) -> MET. First match wins, so order by
# specificity. "row"/"box" only ever see duration-based entries, so they mean rowing/boxing.
_MET_TABLE: list[tuple[tuple[str, ...], float]] = [
    (("walk",), 3.5),
    (("tennis",), 7.0),
    (("swim",), 7.0),
    (("yoga",), 2.8),
    (("pilates",), 3.0),
    (("hik",), 6.0),
    (("basketball",), 6.5),
    (("soccer", "football"), 7.0),
    (("cycl", "bike", "bicycl", "spinning", "recumbent"), 7.0),
    (("row",), 7.0),
    (("elliptical",), 5.0),
    (("stair", "step mill", "step-mill", "stepmill"), 9.0),
    (("rope", "skip"), 11.0),
    (("danc",), 5.0),
    (("box",), 7.0),
    (("ellipt",), 5.0),
]
_RUN_KEYS = ("treadmill", "running", "jog", "sprint")
# walking/running on a measured distance: use the ACSM metabolic equations, which factor INCLINE.
_WALK_RUN_KEYS = ("treadmill", "running", "jog", "sprint", "walk", "hik")
DEFAULT_MET = 6.0  # unknown cardio/activity


def _acsm_kcal(speed_m_per_min: float, grade: float, weight_kg: float, minutes: float) -> float:
    """ACSM walking/running metabolic equations (VO2 ml/kg/min) — these include treadmill grade,
    which a flat MET cannot. Running eq applies at ~8 km/h (134 m/min). kcal = VO2 * kg / 1000 *
    5 kcal/L * minutes."""
    s = max(0.0, speed_m_per_min)
    if s >= 134:  # running
        vo2 = 0.2 * s + 0.9 * s * grade + 3.5
    else:         # walking
        vo2 = 0.1 * s + 1.8 * s * grade + 3.5
    return max(0.0, vo2) * weight_kg / 1000.0 * 5.0 * minutes


def _run_met(speed_kmh: float) -> float:
    if speed_kmh < 5.0:
        return 3.5      # walking pace
    if speed_kmh < 6.5:
        return 5.0      # brisk
    if speed_kmh < 8.0:
        return 8.0      # jog
    if speed_kmh < 11.0:
        return 9.8
    if speed_kmh < 13.0:
        return 11.5
    return 13.0


def met_for(name: str, duration_s: int | None = None, distance_m: int | None = None) -> float:
    l = (name or "").lower()
    for keys, met in _MET_TABLE:
        if any(k in l for k in keys):
            return met
    if any(k in l for k in _RUN_KEYS):
        if duration_s and distance_m:
            speed_kmh = (distance_m / 1000.0) / (duration_s / 3600.0)
            return _run_met(speed_kmh)
        return 9.0
    return DEFAULT_MET


def estimate_kcal(name: str, duration_s: int | None, distance_m: int | None,
                  weight_kg: float | None, incline_pct: float | None = None) -> int | None:
    """kcal for one duration-based entry, or None if it can't be estimated. For walking/running
    on a measured distance, uses the ACSM equations so treadmill INCLINE counts; otherwise a flat
    MET. Estimate only."""
    if not duration_s or not weight_kg:
        return None
    minutes = duration_s / 60.0
    l = (name or "").lower()
    if distance_m and any(k in l for k in _WALK_RUN_KEYS):
        speed_m_per_min = distance_m / minutes
        grade = max(0.0, float(incline_pct or 0.0)) / 100.0
        return int(round(_acsm_kcal(speed_m_per_min, grade, float(weight_kg), minutes)))
    kcal = met_for(name, duration_s, distance_m) * float(weight_kg) * (duration_s / 3600.0)
    return int(round(kcal))
