"use client";
/* Home. Answers one question in the first screen: what's today, and where do I start.
   Today's workout is the one lifted object; three quick-log tiles open sheets; the coach speaks
   in one line; the plan is a compact list below. No forms live here. */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, configured, homeData, type HomeData, type ProgramSlot } from "@/lib/api";
import { enqueue, subscribeQueue } from "@/lib/queue";
import CoachNote from "./CoachNote";
import DescribeWorkout from "./DescribeWorkout";
import ExerciseAnimation from "./ExerciseAnimation";
import ExerciseDetail from "./ExerciseDetail";
import { VitalsSheet, WeighInSheet } from "./QuickLog";
import Empty from "./ui/Empty";

const SKEY = "active_session_v2";
type ActiveSession = { id: string; startedAt: string; logged: { slotId: string }[]; adhoc: ProgramSlot[] };

function loadSession(): ActiveSession | null {
  try {
    const raw = localStorage.getItem(SKEY);
    return raw ? (JSON.parse(raw) as ActiveSession) : null;
  } catch {
    return null;
  }
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
const isCardio = (s: ProgramSlot) => s.category === "cardio";
function estMinutes(slots: ProgramSlot[]) {
  const m = slots.reduce((t, s) => t + (isCardio(s) ? 20 : (s.sets ?? 3) * 2.25), 0);
  return Math.max(5, Math.round(m / 5) * 5);
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unconfigured" | "error">("loading");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [queued, setQueued] = useState(0);
  const [sheet, setSheet] = useState<null | "weight" | "vitals">(null);
  const [describe, setDescribe] = useState(false);
  const [detail, setDetail] = useState<ProgramSlot | null>(null);
  const [savedKg, setSavedKg] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!configured()) return setState("unconfigured");
    homeData()
      .then((d) => {
        setData(d);
        setState("ok");
      })
      .catch(() => setState((s) => (s === "ok" ? s : "error")));
  }, []);

  useEffect(() => {
    load();
    setSession(loadSession());
    // first run: nobody else routes a fresh token to the wizard
    if (configured() && localStorage.getItem("coach_onboarded") !== "1") {
      apiGet<{ onboarded: boolean }>("/api/onboarding/status")
        .then((d) => { if (d.onboarded) localStorage.setItem("coach_onboarded", "1"); else router.replace("/onboarding"); })
        .catch(() => {});
    }
    return subscribeQueue(setQueued);
  }, [load, router]);

  const start = useCallback(() => {
    const s: ActiveSession = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), logged: [], adhoc: [] };
    localStorage.setItem(SKEY, JSON.stringify(s));
    void enqueue("/api/sessions/start", { session_id: s.id, started_at: s.startedAt });
    if (navigator.vibrate) navigator.vibrate(10);
    router.push("/workout");
  }, [router]);

  const slots = data?.slots ?? [];
  const groups = useMemo(() => {
    const g: { name: string; slots: ProgramSlot[] }[] = [];
    for (const s of slots) {
      const name = s.program_name || "";
      const last = g[g.length - 1];
      if (last && last.name === name) last.slots.push(s);
      else g.push({ name, slots: [s] });
    }
    return g;
  }, [slots]);
  const programNames = groups.map((g) => g.name).filter(Boolean);
  const plannedSets = slots.reduce((t, s) => t + (isCardio(s) ? 1 : s.sets ?? 0), 0);
  const doneSets = session?.logged.length ?? 0;

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-3 rise">
        <div className="min-w-0">
          <p className="eyebrow">
            {todayLabel()}
            {queued > 0 && <span className="ml-2 text-warn">· {queued} to sync</span>}
          </p>
          <h1 className="t-title mt-1.5">{greeting()}</h1>
        </div>
        <Link href="/settings" aria-label="Setup" className="iconbtn shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
          </svg>
        </Link>
      </header>

      {state === "unconfigured" && (
        <div className="card p-5 rise">
          <Empty line="Paste your access token once and everything goes live." action="Open Setup" href="/settings" compact />
        </div>
      )}
      {state === "error" && (
        <div className="card p-5 rise">
          <Empty line="Can't reach the server. Logs you make now sync when you're back." compact />
        </div>
      )}
      {state === "loading" && <div className="card-lift h-44 animate-pulse rise" />}

      {state === "ok" && (
        <section className="card-lift p-5 rise" data-testid="workout-hero">
          <p className="eyebrow">
            {slots.length ? `Today · ${programNames.join(" + ") || "Workout"}` : "Today"}
          </p>
          {slots.length ? (
            <>
              <div className="flex items-end justify-between gap-3 mt-2">
                <div>
                  <p className="t-hero">{slots.length}<span className="text-dim text-2xl font-display font-semibold ml-1.5">exercises</span></p>
                  <p className="t-sec mt-2 tnum">~{estMinutes(slots)} min · {plannedSets} sets</p>
                </div>
              </div>
              {plannedSets > 0 && (
                <div className="pills mt-4" aria-label={`${doneSets} of ${plannedSets} sets logged`}>
                  {Array.from({ length: Math.min(plannedSets, 24) }, (_, i) => (
                    <i key={i} data-on={i < Math.round((doneSets / plannedSets) * Math.min(plannedSets, 24))} />
                  ))}
                </div>
              )}
              {session ? (
                <Link href="/workout" className="btn btn-primary w-full h-14 mt-5 text-base">
                  Continue workout
                  <span className="opacity-70 font-normal">· {doneSets} logged</span>
                </Link>
              ) : (
                <button onClick={start} className="btn btn-primary w-full h-14 mt-5 text-base">Start workout</button>
              )}
            </>
          ) : (
            <>
              <p className="t-title mt-2">Rest day</p>
              <p className="t-sec mt-1.5">Nothing scheduled. Move if you feel like it.</p>
              {session ? (
                <Link href="/workout" className="btn btn-primary w-full h-14 mt-5 text-base">Continue workout</Link>
              ) : (
                <button onClick={start} className="btn btn-ghost w-full h-12 mt-5">Start an open session</button>
              )}
            </>
          )}
          <button onClick={() => setDescribe(true)} className="btn btn-quiet w-full h-9 mt-2 text-xs">
            Log a workout you already did
          </button>
        </section>
      )}

      <section className="grid grid-cols-3 gap-2.5 rise">
        <button onClick={() => setSheet("weight")} className="tile" aria-label="Weigh in">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 10a4 4 0 0 1 8 0M12 10l2-2" /></svg>
          <span>{savedKg != null ? `${savedKg.toFixed(1)} kg ✓` : "Weigh in"}</span>
        </button>
        <Link href="/nutrition?add=1" className="tile" data-hue="food" aria-label="Log food">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16M6 12a6 6 0 0 1 12 0M5 16h14M8 20h8" /></svg>
          <span>Log food</span>
        </Link>
        <button onClick={() => setSheet("vitals")} className="tile" data-hue="vitals" aria-label="Log blood pressure">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2-5 3 10 2-6 1.5 1H21" /></svg>
          <span>Log BP</span>
        </button>
      </section>

      <CoachNote />

      {state === "ok" && slots.length > 0 && (
        <section className="rise">
          <div className="flex items-baseline justify-between mb-1">
            <p className="eyebrow">The plan</p>
            <Link href="/train" className="text-xs text-dim active:text-bone font-mono">Edit</Link>
          </div>
          {groups.map((g, gi) => (
            <div key={g.name || gi}>
              {groups.filter((x) => x.name).length > 1 && g.name && (
                <p className="text-xs font-mono text-dim mt-3 mb-0.5">{g.name}</p>
              )}
              {g.slots.map((s) => {
                const done = session ? session.logged.filter((l) => l.slotId === s.program_exercise_id).length : 0;
                return (
                  <button key={s.program_exercise_id} onClick={() => setDetail(s)} className="row">
                    <ExerciseAnimation frames={s.image_urls} alt={s.name} className="w-10 h-10 rounded-lg shrink-0 border border-line" intervalMs={1400} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[15px] font-medium">{s.name}</span>
                      <span className="block t-sec tnum">
                        {isCardio(s) ? "cardio" : s.sets ? `${s.sets} × ${s.reps}` : "open"}
                        {s.suggested_kg ? ` · ${s.suggested_kg} kg` : ""}
                      </span>
                    </span>
                    {done > 0 && <span className="text-xs font-mono text-volt tnum">{done}/{s.sets ?? done}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      )}

      {state === "ok" && data && (
        <section className="rise">
          <p className="eyebrow mb-1">This week</p>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat n={data.week.sessions_completed} label="workouts" />
            <Stat n={data.week.days_logged} label="food days" />
            <Stat n={data.week.weighins} label="weigh-ins" />
          </div>
        </section>
      )}

      <WeighInSheet open={sheet === "weight"} onClose={() => setSheet(null)} latestKg={data?.latest_weight_kg ?? null}
        onSaved={(kg) => { setSavedKg(kg); setTimeout(load, 500); }} />
      <VitalsSheet open={sheet === "vitals"} onClose={() => setSheet(null)} onSaved={() => setTimeout(load, 500)} />
      {describe && <DescribeWorkout onClose={() => setDescribe(false)} onLogged={() => setTimeout(load, 500)} />}
      {detail && <ExerciseDetail exerciseId={detail.exercise_id} name={detail.name} frames={detail.image_urls} onClose={() => setDetail(null)} />}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="t-num text-2xl leading-none">{n}</p>
      <p className="t-sec mt-1">{label}</p>
    </div>
  );
}
