/* API client. Base URL + bearer token live in localStorage (single-user app);
   set them once on the SET-UP tab. All writes flow through the offline queue. */

export function apiBase(): string {
  if (typeof window === "undefined") return "";
  // Same origin by default: Next rewrites proxy /api,/coach,/knowledge to the backend, so
  // a relative path works locally AND behind Tailscale serve / nginx (no CORS, no setup).
  // A stored value (Setup tab) or NEXT_PUBLIC_API_URL can override for split deployments.
  return localStorage.getItem("coach_api_base") || process.env.NEXT_PUBLIC_API_URL || "";
}
export function token(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("coach_token") || process.env.NEXT_PUBLIC_DEV_TOKEN || "";
}
export function configured(): boolean {
  return Boolean(token());
}

/* A 401 while a token IS configured means it expired (they're minted with a 1-year exp) or was
   revoked — without this signal the app just silently stops saving one day. AuthBanner listens. */
function noteAuthFailure(status: number) {
  if (status === 401 && typeof window !== "undefined" && token()) {
    window.dispatchEvent(new CustomEvent("coach:auth-expired"));
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    noteAuthFailure(res.status);
    throw new Error(`GET ${path} -> ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    noteAuthFailure(res.status);
    throw new Error(`POST ${path} -> ${res.status}`);
  }
  return res.json();
}

/* Decode the JWT's exp (client-side, display-only — verification happens server-side). */
export function tokenExpiry(): Date | null {
  try {
    const t = token();
    if (!t) return null;
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

export type ProgramSlot = {
  program_exercise_id: string;
  exercise_id: string;
  name: string;
  equipment: string;
  category: string | null;
  sets: number | null;
  reps: number | null;
  load_kg: number | null;
  suggested_kg: number | null;
  suggested_reason: string | null;
  image_urls: string[];
  cues: string[];
  position: number;
  program_id?: string;
  program_name?: string;
};

export type ExerciseStats = {
  exercise_id: string;
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  mechanic: string | null;
  force: string | null;
  level: string | null;
  cues: string[];
  image_urls: string[];
  best_e1rm: number | null;
  heaviest_kg: number | null;
  total_sets: number;
  total_volume: number;
  best_set: { weight_kg: number; reps: number; e1rm: number } | null;
  series: { date: string; e1rm: number; top_weight: number; volume: number }[];
};
export const exerciseStats = (id: string) =>
  apiGet<ExerciseStats>(`/api/exercise/${encodeURIComponent(id)}/stats`);

export type CatalogMatch = {
  exercise_id: string;
  name: string;
  equipment: string;
  category: string | null;
  image_urls: string[];
};
export type ParsedEntry = {
  raw: string;
  kind: "strength" | "cardio";
  exercise_query: string;
  exercise: CatalogMatch | null;
  custom?: boolean;
  candidates: CatalogMatch[];
  confidence: "high" | "medium" | "low";
  note: string;
  rpe: number | null;
  est_kcal?: number | null;
  sets?: number;
  reps?: number;
  weight_kg?: number | null;
  duration_s?: number | null;
  distance_m?: number | null;
};
export async function parseWorkout(
  text: string
): Promise<{ entries: ParsedEntry[] } | { unavailable: true }> {
  const res = await fetch(`${apiBase()}/coach/parse-workout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status === 503) return { unavailable: true };
  if (!res.ok) throw new Error(`parse-workout -> ${res.status}`);
  return res.json();
}

export type FoodPhotoItem = {
  name: string;
  grams: number | null;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  confidence: "high" | "medium" | "low";
};
export async function parseFoodPhoto(
  image: string,
  note?: string
): Promise<{ items: FoodPhotoItem[] } | { unavailable: true }> {
  const res = await fetch(`${apiBase()}/coach/parse-food-photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image, note }),
  });
  if (res.status === 503) return { unavailable: true };
  if (!res.ok) throw new Error(`parse-food-photo -> ${res.status}`);
  return res.json();
}

/* ---- program library ---- */
export type ProgramSummary = { program_id: string; name: string; goal: string | null; sessions_per_week: number; is_active: boolean; scheduled_days: number[]; exercises: number };
export type TemplateSummary = { key: string; name: string; goal: string; sessions_per_week: number; count: number };
export type DesignedExercise = { exercise_id: string; name: string; sets: number; reps: number };
export type DesignedProgram = { name: string; goal: string | null; sessions_per_week: number; exercises: DesignedExercise[]; note: string | null };

export const listPrograms = () => apiGet<{ programs: ProgramSummary[] }>("/api/programs").then((r) => r.programs);
export const listTemplates = () => apiGet<{ templates: TemplateSummary[] }>("/api/programs/templates").then((r) => r.templates);
export const getTemplate = (key: string) => apiGet<DesignedProgram>(`/api/programs/template/${encodeURIComponent(key)}`);
export async function designProgram(goal: string): Promise<DesignedProgram | { unavailable: true }> {
  const res = await fetch(`${apiBase()}/coach/design-program`, {
    method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  if (res.status === 503) return { unavailable: true };
  if (!res.ok) throw new Error(`design-program -> ${res.status}`);
  return res.json();
}
export const addProgram = (p: { name: string; goal: string | null; sessions_per_week: number; exercises: { exercise_id: string; sets: number; reps: number }[] }) =>
  apiPost("/api/programs", p);
export const setProgramActive = (program_id: string, active: boolean) => apiPost("/api/programs/active", { program_id, active });
export const setProgramSchedule = (program_id: string, days: number[]) => apiPost("/api/programs/schedule", { program_id, days });
export const deleteProgram = (program_id: string) => apiPost("/api/programs/delete", { program_id });
export const clearInactivePrograms = () => apiPost<{ deleted: number }>("/api/programs/clear-inactive", {});

/* ---- coach endpoints (separate from /api; may be 503 if no LLM configured) ---- */
export type Evidence = { label: string; detail: string };
export type CoachReply =
  | { kind: "reply"; text: string; evidence?: Evidence[] }
  | { kind: "confirm"; payload: { proposal: unknown; reason: string; diff?: { label: string; from: string; to: string }[] } }
  | { kind: "unavailable"; retryAt?: string | null };

/* When is the coach back? The server knows each model's provider cooldown (coach/llm.py). */
export function whenBack(retryAt?: string | null): string | null {
  if (!retryAt) return null;
  const t = new Date(retryAt);
  if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return null;
  const sameDay = t.toDateString() === new Date().toDateString();
  return sameDay
    ? t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : t.toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
}

export function offlineMessage(retryAt?: string | null): string {
  const when = whenBack(retryAt);
  return when
    ? `The coach is offline until about ${when} — every AI model it can use is rate-limited. Logging still works.`
    : "The coach couldn't reach an AI model just now. Logging still works — try again in a few minutes.";
}

export type CoachStatus = { configured: boolean; available: boolean; active_model: string | null; retry_at: string | null };
export async function coachStatus(): Promise<CoachStatus | null> {
  try {
    return await apiGet<CoachStatus>("/coach/status");
  } catch {
    return null;
  }
}

async function coachPost(path: string, body: unknown): Promise<CoachReply> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 503) {
    const b = await res.json().catch(() => ({}));
    return { kind: "unavailable", retryAt: b.retry_at ?? null };
  }
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  const d = await res.json();
  if (d.status === "needs_confirmation") return { kind: "confirm", payload: d.payload };
  return { kind: "reply", text: d.reply, evidence: d.evidence };
}

export const coachChat = (thread_id: string, message: string) =>
  coachPost("/coach/chat", { thread_id, message });

export const coachConfirm = (thread_id: string, approved: boolean) =>
  coachPost("/coach/confirm", { thread_id, approved });

export type Insight = { note: string | null; generated_at: string; focus: string; cached: boolean };

export async function coachInsight(refresh = false, focus = "auto"): Promise<Insight | null> {
  try {
    const qs = new URLSearchParams();
    if (refresh) qs.set("refresh", "true");
    if (focus && focus !== "auto") qs.set("focus", focus);
    const q = qs.toString();
    const res = await fetch(`${apiBase()}/coach/insight${q ? `?${q}` : ""}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Insight;
  } catch {
    return null;
  }
}

export type CoachThread = { thread_id: string; title: string; updated: string; count: number };
export async function coachThreads(): Promise<CoachThread[]> {
  try {
    return (await apiGet<{ threads: CoachThread[] }>("/coach/threads")).threads;
  } catch {
    return [];
  }
}
export type StoredMsg = { role: string; text: string; evidence?: { label: string; detail: string }[] | null };
export async function coachThreadMessages(threadId: string): Promise<StoredMsg[]> {
  try {
    return (await apiGet<{ messages: StoredMsg[] }>(`/coach/threads/${encodeURIComponent(threadId)}`)).messages;
  } catch {
    return [];
  }
}

export type Review = { status: string; summary: string; changes: Record<string, unknown>; created_at: string } | null;

export async function coachLatestReview(): Promise<Review> {
  try {
    const res = await fetch(`${apiBase()}/coach/review/latest`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Review;
  } catch {
    return null;
  }
}

/* ---- home ---- */
export type HomeData = {
  date: string;
  slots: ProgramSlot[];
  program: { name?: string } | null;
  latest_weight_kg: number | null;
  week: { sessions_completed: number; sessions_prescribed: number; days_logged: number; weighins: number };
  latest_vital: { recorded_at: string; systolic: number | null; diastolic: number | null; heart_rate: number | null } | null;
};
export const homeData = () => apiGet<HomeData>("/api/home");
