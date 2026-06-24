"""REST API for the PWA (Today screen + offline sync).

Design notes:
  * All ids for sessions/sets are CLIENT-generated UUIDs and every write is
    idempotent (insert ... on conflict do nothing), so the offline queue can
    replay a batch any number of times safely.
  * user_id comes only from the verified JWT (auth.get_current_user_id).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from . import media
from pydantic import BaseModel, Field

from . import safety as safety_mod
from .auth import get_current_user_id
from .models import Targets

router = APIRouter(prefix="/api")

# set by service.py at startup
_repo = None


def bind_repo(repo) -> None:
    global _repo
    _repo = repo


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/program/today")
async def program_today(user_id: str = Depends(get_current_user_id)):
    slots = await _repo.get_program_slots(user_id)
    meta = await _repo.get_active_program_meta(user_id)
    return {"date": _now().date().isoformat(), "slots": slots, "program": meta}


class SessionStartIn(BaseModel):
    session_id: str  # client-generated uuid
    started_at: Optional[datetime] = None


@router.post("/sessions/start")
async def session_start(body: SessionStartIn, user_id: str = Depends(get_current_user_id)):
    await _repo.start_session(user_id, body.session_id, body.started_at or _now())
    return {"status": "ok", "session_id": body.session_id}


class SetIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    exercise_id: str
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    rpe: Optional[float] = None
    set_type: Optional[str] = None     # normal (default) | warmup | drop | failure
    duration_s: Optional[int] = None   # cardio: seconds
    distance_m: Optional[int] = None   # cardio: meters
    incline_pct: Optional[float] = None  # cardio: treadmill incline %, factors into kcal (ACSM)
    logged_at: datetime


class SetSyncIn(BaseModel):
    session_id: str
    sets: list[SetIn] = Field(default_factory=list)


@router.post("/sets/sync")
async def sets_sync(body: SetSyncIn, user_id: str = Depends(get_current_user_id)):
    try:
        inserted = await _repo.insert_set_logs(
            user_id, body.session_id, [s.model_dump() for s in body.sets]
        )
    except PermissionError:
        # Session can't be attached (no active program, or not this user's). Permanent for this
        # payload — return 4xx so the offline queue DROPS it instead of retrying a 500 forever.
        raise HTTPException(422, "session not found or not attachable")
    return {"status": "ok", "received": len(body.sets), "inserted": inserted}


class SetDeleteIn(BaseModel):
    session_id: str
    set_id: str  # client-generated uuid of the logged set


@router.post("/sets/delete")
async def sets_delete(body: SetDeleteIn, user_id: str = Depends(get_current_user_id)):
    """Remove a logged set. Idempotent (deleting a missing id is a no-op), so it's safe
    to replay through the offline queue. Scoped to the caller's own session."""
    deleted = await _repo.delete_set_log(user_id, body.session_id, body.set_id)
    return {"status": "ok", "deleted": deleted}


class SetUpdateIn(BaseModel):
    session_id: str
    set_id: str
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    rpe: Optional[float] = None
    set_type: Optional[str] = None
    duration_s: Optional[int] = None
    distance_m: Optional[int] = None


@router.post("/sets/update")
async def sets_update(body: SetUpdateIn, user_id: str = Depends(get_current_user_id)):
    """Edit a logged set's reps/weight in place. Setting the same values again is a no-op,
    so it's safe to replay through the offline queue. Scoped to the caller's own session."""
    updated = await _repo.update_set_log(
        user_id, body.session_id, body.set_id, body.reps, body.weight_kg,
        body.duration_s, body.distance_m, body.rpe, body.set_type,
    )
    return {"status": "ok", "updated": updated}


class SessionCompleteIn(BaseModel):
    session_id: str
    completed_at: Optional[datetime] = None


@router.post("/sessions/complete")
async def session_complete(body: SessionCompleteIn, user_id: str = Depends(get_current_user_id)):
    await _repo.complete_session(user_id, body.session_id, body.completed_at or _now())
    return {"status": "ok"}


@router.get("/sessions")
async def session_history(limit: int = 30, user_id: str = Depends(get_current_user_id)):
    """Past workouts with their logged sets, for the history screen."""
    return {"sessions": await _repo.get_session_history(user_id, limit)}


@router.get("/exercise/{exercise_id}/stats")
async def exercise_stats(exercise_id: str, user_id: str = Depends(get_current_user_id)):
    """Per-exercise progression: lifetime bests (est-1RM, heaviest, volume) + a per-session
    series for charting. Powers PR detection on Today and the exercise detail view."""
    return await _repo.get_exercise_stats(user_id, exercise_id)


@router.get("/export")
async def export_data(user_id: str = Depends(get_current_user_id)):
    """Full export of the user's own data (weight, nutrition, workouts, vitals, program,
    reviews) for backup. JSON; the client can also derive CSVs from it."""
    data = await _repo.export_all(user_id)
    return {"exported_at": _now().isoformat(), "schema": "gym-coach-export-1", **data}


@router.get("/trends")
async def trends(window: int = 30, user_id: str = Depends(get_current_user_id)):
    profile = await _repo.get_profile(user_id)
    trend = await _repo.get_weight_trend(user_id, window)
    adherence = await _repo.get_adherence(user_id, window)
    series = await _repo.get_weight_series(user_id, window)
    energy_balance = await _repo.get_energy_balance(user_id, 7)
    return {
        "window_days": window,
        "goal_weight_kg": profile.goal_weight_kg,
        "weight_series": series,
        "trend": trend.model_dump(),
        "adherence": adherence.model_dump(),
        "energy": energy_balance,
    }


class WeightIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    weight_kg: float
    recorded_at: datetime


@router.post("/metrics/weight")
async def log_weight(body: WeightIn, user_id: str = Depends(get_current_user_id)):
    await _repo.insert_body_metric(user_id, body.id, body.recorded_at, body.weight_kg)
    return {"status": "ok"}


class WeightSetIn(BaseModel):
    recorded_on: str  # ISO date — the calendar day to set
    weight_kg: float


@router.post("/metrics/weight/set")
async def set_weight(body: WeightSetIn, user_id: str = Depends(get_current_user_id)):
    """Set the canonical weight for a day (replaces that day's weigh-ins). Powers the
    Trends chart's tap-to-edit; effect-idempotent so it's safe through the offline queue."""
    from datetime import date, time
    import uuid as _uuid
    day = date.fromisoformat(body.recorded_on)
    recorded_at = datetime.combine(day, time(12, 0), tzinfo=timezone.utc)
    await _repo.set_weight_for_date(user_id, day, body.weight_kg, recorded_at, str(_uuid.uuid4()))
    return {"status": "ok", "recorded_on": day.isoformat()}


class WeightDeleteIn(BaseModel):
    recorded_on: str  # ISO date


@router.post("/metrics/weight/delete")
async def delete_weight(body: WeightDeleteIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.recorded_on)
    deleted = await _repo.delete_weight_for_date(user_id, day)
    return {"status": "ok", "deleted": deleted}


# ----------------------------- vitals (BP / heart rate) ---------------------

class VitalIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    recorded_at: datetime
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    heart_rate: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None


@router.post("/vitals")
async def log_vital(body: VitalIn, user_id: str = Depends(get_current_user_id)):
    await _repo.insert_vital(
        user_id, body.id, body.recorded_at, body.systolic, body.diastolic,
        body.heart_rate, body.tag, body.note,
    )
    return {"status": "ok"}


class VitalUpdateIn(BaseModel):
    id: str
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    heart_rate: Optional[int] = None
    tag: Optional[str] = None
    note: Optional[str] = None


@router.post("/vitals/update")
async def update_vital(body: VitalUpdateIn, user_id: str = Depends(get_current_user_id)):
    updated = await _repo.update_vital(
        user_id, body.id, body.systolic, body.diastolic, body.heart_rate, body.tag, body.note,
    )
    return {"status": "ok", "updated": updated}


class VitalDeleteIn(BaseModel):
    id: str


@router.post("/vitals/delete")
async def delete_vital(body: VitalDeleteIn, user_id: str = Depends(get_current_user_id)):
    deleted = await _repo.delete_vital(user_id, body.id)
    return {"status": "ok", "deleted": deleted}


@router.get("/vitals")
async def list_vitals(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    return {"vitals": await _repo.get_vitals(user_id, limit)}


@router.get("/nutrition")
async def nutrition(window: int = 14, user_id: str = Depends(get_current_user_id)):
    summary = await _repo.get_nutrition_summary(user_id, window)
    series = await _repo.get_nutrition_series(user_id, window)
    targets = await _repo.get_current_targets(user_id)
    return {
        **summary.model_dump(),
        "series": series,
        "target_protein_g": targets.protein_g if targets else None,
    }


# ----------------------------- food database (Open Food Facts) --------------

@router.get("/foods/search")
async def foods_search(q: str, user_id: str = Depends(get_current_user_id)):
    """Search the Open Food Facts catalog (per-100g nutrition). Proxied + normalized so the
    PWA gets a small, consistent shape. Only foods with a kcal value are returned."""
    import httpx

    if not q.strip():
        return {"foods": []}
    url = "https://search.openfoodfacts.org/search"
    params = {"q": q.strip(), "page_size": 25}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(url, params=params, headers={"User-Agent": "gym-coach/1.0"})
            r.raise_for_status()
            data = r.json()
    except Exception:
        return {"foods": [], "error": "search_unavailable"}

    foods = []
    for h in data.get("hits", []):
        n = h.get("nutriments") or {}
        kcal = n.get("energy-kcal_100g")
        if kcal is None:
            continue
        name = h.get("product_name") or h.get("product_name_en")
        if isinstance(name, (list, dict)):  # some entries return localized variants
            name = (name[0] if isinstance(name, list) and name else None)
        if not name or not isinstance(name, str):
            continue
        brands = h.get("brands")
        if isinstance(brands, list):
            brand = brands[0] if brands else None
        elif isinstance(brands, str):
            brand = brands.split(",")[0] or None
        else:
            brand = None
        sq = h.get("serving_quantity")
        foods.append({
            "code": h.get("code"),
            "name": name[:120],
            "brand": brand[:60] if brand else None,
            "kcal_100g": round(float(kcal)),
            "protein_100g": round(float(n.get("proteins_100g") or 0), 1),
            "carbs_100g": round(float(n.get("carbohydrates_100g") or 0), 1),
            "fat_100g": round(float(n.get("fat_100g") or 0), 1),
            "fiber_100g": round(float(n.get("fiber_100g") or 0), 1),
            "serving_g": round(float(sq)) if sq else None,
        })
        if len(foods) >= 20:
            break
    return {"foods": foods}


@router.get("/foods/recent")
async def foods_recent(limit: int = 12, user_id: str = Depends(get_current_user_id)):
    """Recently-logged foods for one-tap re-logging."""
    return {"foods": await _repo.get_recent_foods(user_id, limit)}


@router.get("/foods/barcode/{code}")
async def foods_barcode(code: str, user_id: str = Depends(get_current_user_id)):
    """Look up a food by barcode via Open Food Facts (per-100g nutrition). The product API is
    intermittently rate-limited, so try the primary + mirror host before giving up."""
    import httpx

    hosts = ["https://world.openfoodfacts.org", "https://world.openfoodfacts.net"]
    params = {"fields": "product_name,brands,nutriments,serving_quantity"}
    responded = False
    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "gym-coach/1.0"}) as client:
        for host in hosts:
            try:
                r = await client.get(f"{host}/api/v2/product/{code}.json", params=params)
            except Exception:
                continue
            if r.status_code != 200:
                continue
            try:
                data = r.json()
            except ValueError:
                continue
            responded = True
            p = data.get("product") or {}
            n = p.get("nutriments") or {}
            kcal = n.get("energy-kcal_100g")
            name = p.get("product_name")
            if kcal is None or not name or not isinstance(name, str):
                continue  # found nothing usable here — try the mirror
            brands = p.get("brands")
            if isinstance(brands, list):
                brand = brands[0] if brands else None
            elif isinstance(brands, str):
                brand = brands.split(",")[0] or None
            else:
                brand = None
            sq = p.get("serving_quantity")
            return {"food": {
                "code": code,
                "name": name[:120],
                "brand": brand[:60] if brand else None,
                "kcal_100g": round(float(kcal)),
                "protein_100g": round(float(n.get("proteins_100g") or 0), 1),
                "carbs_100g": round(float(n.get("carbohydrates_100g") or 0), 1),
                "fat_100g": round(float(n.get("fat_100g") or 0), 1),
                "fiber_100g": round(float(n.get("fiber_100g") or 0), 1),
                "serving_g": round(float(sq)) if sq else None,
            }}
    return {"food": None} if responded else {"food": None, "error": "lookup_unavailable"}


class FoodLogIn(BaseModel):
    id: str  # client-generated uuid -> idempotency key
    logged_on: Optional[str] = None
    name: str
    brand: Optional[str] = None
    grams: Optional[float] = None
    kcal: int
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    fiber_g: Optional[float] = None


@router.post("/foods/log")
async def foods_log(body: FoodLogIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.logged_on) if body.logged_on else _now().date()
    await _repo.insert_food_entry(
        user_id, body.id, day, body.name, body.brand, body.grams, body.kcal, body.protein_g,
        body.carbs_g, body.fat_g, body.fiber_g,
    )
    totals = await _repo.recompute_nutrition_day(user_id, day)
    return {"status": "ok", "logged_on": day.isoformat(), "day_totals": totals}


@router.get("/foods")
async def foods_for_day(date: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    from datetime import date as _date
    day = _date.fromisoformat(date) if date else _now().date()
    return {"date": day.isoformat(), "foods": await _repo.get_food_entries(user_id, day)}


class FoodDeleteIn(BaseModel):
    id: str
    logged_on: str


@router.post("/foods/delete")
async def foods_delete(body: FoodDeleteIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.logged_on)
    await _repo.delete_food_entry(user_id, body.id)
    totals = await _repo.recompute_nutrition_day(user_id, day)
    return {"status": "ok", "day_totals": totals}


# ----------------------------- saved meals -----------------------------------
class MealItemIn(BaseModel):
    name: str
    brand: Optional[str] = None
    grams: Optional[float] = None
    kcal: int
    protein_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fat_g: Optional[float] = None
    fiber_g: Optional[float] = None


class MealSaveIn(BaseModel):
    name: str
    items: list[MealItemIn] = Field(default_factory=list)


@router.post("/meals")
async def meal_save(body: MealSaveIn, user_id: str = Depends(get_current_user_id)):
    if not body.items:
        raise HTTPException(400, "a meal needs at least one item")
    mid = await _repo.save_meal(user_id, body.name[:80], [i.model_dump() for i in body.items])
    return {"status": "ok", "id": mid}


@router.get("/meals")
async def meals_list(user_id: str = Depends(get_current_user_id)):
    return {"meals": await _repo.list_meals(user_id)}


class MealLogIn(BaseModel):
    meal_id: str
    logged_on: Optional[str] = None


@router.post("/meals/log")
async def meal_log(body: MealLogIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.logged_on) if body.logged_on else _now().date()
    totals = await _repo.log_meal(user_id, body.meal_id, day)
    return {"status": "ok", "logged_on": day.isoformat(), "day_totals": totals}


class MealDeleteIn(BaseModel):
    meal_id: str


@router.post("/meals/delete")
async def meal_delete(body: MealDeleteIn, user_id: str = Depends(get_current_user_id)):
    await _repo.delete_meal(user_id, body.meal_id)
    return {"status": "ok"}


# ----------------------------- body measurements -----------------------------
class MeasurementIn(BaseModel):
    recorded_on: Optional[str] = None
    waist_cm: Optional[float] = None
    belly_cm: Optional[float] = None
    chest_cm: Optional[float] = None
    hips_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    neck_cm: Optional[float] = None
    body_fat_pct: Optional[float] = None
    note: Optional[str] = None


@router.post("/measurements")
async def measurements_log(body: MeasurementIn, user_id: str = Depends(get_current_user_id)):
    """Upsert the day's body measurements (each field optional; provided fields overwrite)."""
    from datetime import date
    day = date.fromisoformat(body.recorded_on) if body.recorded_on else _now().date()
    vals = body.model_dump(exclude={"recorded_on", "note"})
    await _repo.upsert_measurement(user_id, day, vals, body.note)
    return {"status": "ok", "recorded_on": day.isoformat()}


@router.get("/measurements")
async def measurements_list(limit: int = 60, user_id: str = Depends(get_current_user_id)):
    # sex + height let the client estimate body fat (US Navy method) from the tape measurements
    profile = None
    try:
        p = await _repo.get_profile(user_id)
        profile = {"sex": p.sex, "height_cm": p.height_cm}
    except LookupError:
        pass
    return {"measurements": await _repo.get_measurements(user_id, limit), "profile": profile}


class MeasurementDeleteIn(BaseModel):
    recorded_on: str


@router.post("/measurements/delete")
async def measurements_delete(body: MeasurementDeleteIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    await _repo.delete_measurement(user_id, date.fromisoformat(body.recorded_on))
    return {"status": "ok"}


# ----------------------------- progress photos -------------------------------
class PhotoIn(BaseModel):
    image: str  # data URL (downscaled jpeg) from the device camera
    taken_on: Optional[str] = None
    pose: Optional[str] = None
    caption: Optional[str] = None


@router.post("/photos")
async def photo_upload(body: PhotoIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    if not body.image.startswith("data:image/"):
        raise HTTPException(400, "expected a base64 image data URL")
    day = date.fromisoformat(body.taken_on) if body.taken_on else _now().date()
    try:
        filename = media.save_data_url(user_id, body.image)
    except ValueError:
        raise HTTPException(400, "bad image")
    return {"status": "ok", "photo": await _repo.save_photo(user_id, day, body.pose, filename, body.caption)}


@router.get("/photos")
async def photos_list(user_id: str = Depends(get_current_user_id)):
    return {"photos": await _repo.list_photos(user_id)}


@router.get("/photos/{photo_id}")
async def photo_image(photo_id: str, user_id: str = Depends(get_current_user_id)):
    p = await _repo.get_photo(user_id, photo_id)
    if not p:
        raise HTTPException(404, "not found")
    return FileResponse(media.image_path(user_id, p["filename"]))


class PhotoDeleteIn(BaseModel):
    id: str


@router.post("/photos/delete")
async def photo_delete(body: PhotoDeleteIn, user_id: str = Depends(get_current_user_id)):
    filename = await _repo.delete_photo(user_id, body.id)
    if filename:
        media.delete_file(user_id, filename)
    return {"status": "ok"}


class PhotoUpdateIn(BaseModel):
    id: str
    taken_on: Optional[str] = None  # ISO date to backdate the photo to when it was taken
    caption: Optional[str] = None


@router.post("/photos/update")
async def photo_update(body: PhotoUpdateIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.taken_on) if body.taken_on else None
    await _repo.update_photo(user_id, body.id, taken_on=day, caption=body.caption)
    return {"status": "ok"}


class NutritionIn(BaseModel):
    logged_on: Optional[str] = None  # ISO date; defaults to today
    kcal: Optional[int] = None
    protein_g: Optional[float] = None


@router.post("/nutrition")
async def log_nutrition(body: NutritionIn, user_id: str = Depends(get_current_user_id)):
    from datetime import date
    day = date.fromisoformat(body.logged_on) if body.logged_on else _now().date()
    await _repo.upsert_nutrition_day(user_id, day, body.kcal, body.protein_g)
    return {"status": "ok", "logged_on": day.isoformat()}


# ----------------------------- onboarding -----------------------------------

@router.get("/onboarding/status")
async def onboarding_status(user_id: str = Depends(get_current_user_id)):
    try:
        await _repo.get_profile(user_id)
        return {"onboarded": True}
    except LookupError:
        return {"onboarded": False}


@router.get("/profile")
async def get_profile_ep(user_id: str = Depends(get_current_user_id)):
    """The user's stored details (profiles table): sex, birth year, height, activity, goal."""
    try:
        return (await _repo.get_profile(user_id)).model_dump(mode="json")
    except LookupError:
        raise HTTPException(404, "not onboarded yet")


class ProfileUpdateIn(BaseModel):
    sex: Optional[str] = None
    birth_year: Optional[int] = None
    height_cm: Optional[float] = None
    activity_level: Optional[str] = None
    goal_weight_kg: Optional[float] = None
    weekly_rate_kg: Optional[float] = None


@router.post("/profile")
async def update_profile_ep(body: ProfileUpdateIn, user_id: str = Depends(get_current_user_id)):
    """Edit stored details. The goal rate is capped server-side; targets are NOT recomputed
    here (they come from onboarding / the coach's gated path)."""
    if body.sex is not None and body.sex not in ("male", "female", "other"):
        raise HTTPException(400, "sex must be male, female, or other")
    rate = body.weekly_rate_kg
    if rate is not None:
        rate = min(max(rate, 0.0), safety_mod.MAX_SAFE_WEEKLY_RATE_KG)
    await _repo.update_profile(
        user_id, sex=body.sex, birth_year=body.birth_year, height_cm=body.height_cm,
        activity_level=body.activity_level, goal_weight_kg=body.goal_weight_kg, weekly_rate_kg=rate,
    )
    return {"status": "ok"}


class OnboardIn(BaseModel):
    sex: str
    birth_year: int
    height_cm: float
    activity_level: str
    current_weight_kg: float
    goal_weight_kg: float
    weekly_rate_kg: float = Field(ge=0)
    injury_active: bool = False
    eating_disorder_history: bool = False


@router.post("/onboarding")
async def onboard(body: OnboardIn, user_id: str = Depends(get_current_user_id)):
    import uuid as _uuid

    flags: list[str] = []
    if body.injury_active:
        flags.append("injury_active")
    if body.eating_disorder_history:
        flags.append("eating_disorder_history")

    # cap the goal rate server-side (client also caps; never trust the client)
    rate = min(body.weekly_rate_kg, safety_mod.MAX_SAFE_WEEKLY_RATE_KG)
    rate_capped = rate < body.weekly_rate_kg

    await _repo.create_profile(
        user_id, sex=body.sex, birth_year=body.birth_year, height_cm=body.height_cm,
        activity_level=body.activity_level, goal_weight_kg=body.goal_weight_kg,
        weekly_rate_kg=rate, medical_flags=flags,
    )
    await _repo.insert_body_metric(user_id, str(_uuid.uuid4()), _now(), body.current_weight_kg)

    profile = await _repo.get_profile(user_id)
    est = safety_mod.estimate_initial_target(profile, body.current_weight_kg)
    if est is None:
        return {"status": "ok", "targets_disabled": True, "rate_capped": rate_capped,
                "note": ("Automated calorie targets are off. Your coach will support training; "
                         "for nutrition guidance, specialized professionals are the right partner.")}

    daily_kcal, protein_g = est
    target = await _repo.insert_target(user_id, Targets(
        daily_kcal=daily_kcal, protein_g=protein_g, source="onboarding",
        rationale="Onboarding starting point — conservative estimate; your coach adjusts it from your real data.",
    ))
    return {"status": "ok", "targets_disabled": False, "rate_capped": rate_capped,
            "target": target.model_dump(mode="json")}


@router.get("/catalog/exercises")
async def catalog_exercises(q: str | None = None, equipment: str | None = None,
                            user_id: str = Depends(get_current_user_id)):
    return {"exercises": _repo.search_catalog(q=q, equipment=equipment, limit=30)}


class ProgramExerciseIn(BaseModel):
    exercise_id: str
    # Optional so cardio exercises (logged by time/distance) don't need sets×reps.
    sets: Optional[int] = Field(default=None, ge=1, le=10)
    reps: Optional[int] = Field(default=None, ge=1, le=100)


class ProgramIn(BaseModel):
    name: str = "Main"
    sessions_per_week: int = Field(ge=1, le=7)
    exercises: list[ProgramExerciseIn] = Field(min_length=1)


@router.post("/program")
async def create_program(body: ProgramIn, user_id: str = Depends(get_current_user_id)):
    pid = await _repo.create_program(
        user_id, body.name, body.sessions_per_week,
        [e.model_dump() for e in body.exercises],
    )
    return {"status": "ok", "program_id": pid}


# ----------------------------- program library -------------------------------
@router.get("/programs")
async def programs_list(user_id: str = Depends(get_current_user_id)):
    return {"programs": await _repo.list_programs(user_id)}


@router.get("/programs/templates")
async def programs_templates(user_id: str = Depends(get_current_user_id)):
    from .programs import TEMPLATES
    return {"templates": [{"key": t["key"], "name": t["name"], "goal": t["goal"],
                           "sessions_per_week": t["sessions_per_week"], "count": len(t["exercises"])}
                          for t in TEMPLATES]}


@router.get("/programs/template/{key}")
async def programs_template(key: str, user_id: str = Depends(get_current_user_id)):
    from .programs import template_program
    p = template_program(key, _repo._catalog)
    if not p:
        raise HTTPException(404, "unknown template")
    return p


class ProgramAddIn(BaseModel):
    name: str
    goal: Optional[str] = None
    sessions_per_week: int = Field(ge=1, le=7)
    exercises: list[dict] = Field(min_length=1)  # {exercise_id, sets?, reps?}


@router.post("/programs")
async def programs_add(body: ProgramAddIn, user_id: str = Depends(get_current_user_id)):
    exs = [{"exercise_id": e["exercise_id"], "sets": e.get("sets"), "reps": e.get("reps")}
           for e in body.exercises if e.get("exercise_id")]
    if not exs:
        raise HTTPException(422, "a program needs at least one exercise")
    pid = await _repo.add_program(user_id, body.name, body.sessions_per_week, exs, goal=body.goal)
    return {"status": "ok", "program_id": pid}


class ProgramActiveIn(BaseModel):
    program_id: str
    active: bool


@router.post("/programs/active")
async def programs_active(body: ProgramActiveIn, user_id: str = Depends(get_current_user_id)):
    await _repo.set_program_active(user_id, body.program_id, body.active)
    return {"status": "ok"}


class ProgramDeleteIn(BaseModel):
    program_id: str


@router.post("/programs/delete")
async def programs_delete(body: ProgramDeleteIn, user_id: str = Depends(get_current_user_id)):
    await _repo.delete_program(user_id, body.program_id)
    return {"status": "ok"}
