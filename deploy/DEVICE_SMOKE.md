# Device smoke test (~6 min after each APK)

Native bugs — WebView file inputs, camera, keyboard, safe areas, bottom sheets, the offline
queue — can't be caught by the Python or Playwright suites. They only show on the phone. Run
this pass after installing a new APK, **with Tailscale ON**, before trusting a build. If a step
fails, capture what the screen shows.

## 0. Install, pair, subscribe (one-time, or after a secret rotation)
- [ ] `python pair.py` on the computer → code 1 installs the APK over the old one.
- [ ] Signed-out Home shows **Pair this phone** → **Scan pairing code** → code 3 → Home loads your
      plan. (A bad or expired code says so and changes nothing.)
- [ ] ntfy app → code 2 subscribes; `python -m coach.notify --title Test --message Hi` arrives.
- [ ] Tap that notification's action → the Gym Coach app opens (not the browser).

## 1. It loads, syncs, and looks right
- [ ] Opens to **Home**; the greeting and today's card clear the status bar; the tab bar
      (Home · Train · Food · Progress · Coach) is fully visible above the gesture bar.
- [ ] **Setup** (gear, top-right of Home) → sync row reads "All changes synced" (or drains
      after "Sync now").
- [ ] **Setup → Look**: switch to **Paper**, then **Mono**, then back to your pick. Text stays
      legible in every look; nothing turns invisible; the status bar matches the ground.

## 2. The workout player (the core loop)
- [ ] **Home → Start workout** opens the player on exercise 1 of N with the demo image looping.
- [ ] Log a **strength set**: the set appears in the list, the pills fill, the phone buzzes, and
      the **rest timer takes the screen**; "+15s" and "Skip rest" both work.
- [ ] Tap a logged set → the edit sheet opens; change the weight, save, the row updates.
- [ ] Swipe/tap **next** to a **cardio** exercise; log time + distance + **incline**.
- [ ] Header → **all exercises** sheet lists the session with per-exercise counts and jumps.
- [ ] **+** (between prev/next) → add an exercise from the catalog; it lands at the end.
- [ ] **Finish** → confirm sheet → summary screen shows sets, exercises, minutes, volume, PRs.
- [ ] Kill the app mid-workout and reopen: **Home says "Continue workout"** with the right count.

## 3. Quick-log sheets
- [ ] **Home → Weigh in** → save; the tile shows the value; **Progress** reflects it.
- [ ] **Home → Log BP** → save; **Progress → Vitals** shows it at the top.
- [ ] **Home → Log food** → the add sheet opens on Food; log a **searched** food, then a
      **recent** one, then a **saved meal** if you have one; the protein ring moves each time.
- [ ] **Food**: tap a past day dot → that day loads; "Back to today" returns.
- [ ] Every sheet closes on backdrop tap and on the system back gesture, without saving.

## 4. Camera, barcode, photos
- [ ] **Food → + → Scan barcode** → the camera opens and a real barcode resolves to a food.
- [ ] **Food → + → Photo a meal** → prompt offers **camera OR gallery**; items come back.
- [ ] **Progress → Progress photos → + Photo** → camera or gallery; it uploads and appears.
      Set an older **date** first and confirm it lands on that date.
- [ ] Tap a photo → **Analyze & recommend** returns text. With 2+, **Compare two** works.

## 5. Programs, history, measurements
- [ ] **Train**: toggle a program **ON/OFF**; set its **day chips**; Home shows only what's
      scheduled today (or the rest-day state).
- [ ] **Train → + Add a program** → a **template** installs; **design from a goal**
      (e.g. "kegels") returns a program you can review and add.
- [ ] **Train → Edit**: **hold ≡ and drag** to reorder — the row follows your finger and the
      order sticks after Save.
- [ ] **Train → History** → open a session → tap a set → edit/remove via the sheet.
- [ ] **Progress → Body measurements** → log waist/belly; the body figure and body-fat estimate
      update.

## 6. Coach
- [ ] **Coach** shows the weekly review (verdict headline) or suggested prompts; tap a prompt.
- [ ] The reply reads as prose and carries **evidence chips**; history survives reopening.
- [ ] Ask something that needs a target change ("should I eat less?") — you get the engine's
      reasoning, not a number it invented.

## 7. Native extras
- [ ] **Setup → Sync from Health Connect** imports weight / BP / resting HR (grant access once).
      Afterwards, a new reading in Health Connect appears after backgrounding + reopening the app
      (auto-sync, at most every 6 h) with no permission prompt.
- [ ] Long-press the app icon → **Weigh in** opens the weigh-in sheet; **Start workout** opens the
      workout; **Log food** opens the food sheet.
- [ ] With the app open on another tab, a `gymcoach://log/weight` notification tap still opens the
      weigh-in sheet.
- [ ] Turn Tailscale off and cold-start the app → **Can't reach your coach** page; turn it on →
      **Try again** loads Home.
- [ ] **Setup → Reminders**: enable one, set a time, grant the notification permission.

## 8. Layout sanity
- [ ] No horizontal scrolling anywhere; no clipped text or numbers on any tab.
- [ ] The keyboard never hides the field you're typing in, the bottom nav, or a sheet's save
      button (check the Coach composer and the Food search).
- [ ] Turn **Tailscale off** → log a set → the header shows the pending count → turn it back on
      → the queue drains and the set is on the server.
