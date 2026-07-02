# Device smoke test (~5 min after each APK)

Native bugs (WebView file inputs, camera, keyboard, safe areas, the offline queue) can't be
caught by the Python test suite — they only show on the phone. Run this quick pass after
installing a new APK, **with Tailscale ON**, before trusting a build. If any step fails, capture
what the screen shows.

## 1. It loads + syncs
- [ ] App opens to **Today**; the tab bar is visible and not cut off top/bottom.
- [ ] **Setup → "N changes waiting to sync"** shows 0 (or drains after "Sync now").

## 2. Logging round-trips (the core loop)
- [ ] **Today**: start a session, log a **strength set** (weight + reps) — it appears immediately.
- [ ] Log a **cardio/treadmill** set with **incline** — shows `min · km · %`.
- [ ] **Trends → weight**: log today's weight; it appears; tap a past weigh-in and edit it.
- [ ] **Trends → Vitals**: log BP + HR — appears instantly (optimistic), still there after reopening.
- [ ] **Trends → Measurements**: log waist/belly; the body figure + body-fat estimate update.
- [ ] **Fuel**: search a food and log it; the day total updates. The search/scan/camera row fits.

## 3. Photos (native camera/gallery)
- [ ] **Trends → Progress photos → + Photo** → prompt offers **camera OR gallery**; pick one; it uploads.
- [ ] Set a **date** for an older photo before adding; it lands on that date.
- [ ] Tap a photo → **Analyze & recommend** returns text. With 2+, **Compare two** works.

## 4. Programs + schedule
- [ ] **Setup → My programs → + Add** → a **template** installs; **"design for a goal"** (e.g. "kegels") returns a program.
- [ ] Set a program's **day chips**; **Today** shows only what's scheduled (or a rest state).

## 5. Coach + reminders
- [ ] **Coach**: ask a question — get a grounded reply with evidence chips; history survives reopening.
- [ ] **Setup → Reminders**: enable one, set a time, grant the notification permission.

## 6. Layout sanity
- [ ] No horizontal scrolling / content cut off on any tab.
- [ ] Keyboard doesn't hide the bottom nav or the field you're typing in.
