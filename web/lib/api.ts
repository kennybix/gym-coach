/* API client. Base URL + bearer token live in localStorage (single-user app);
   set them once on the SET-UP tab. All writes flow through the offline queue. */

export function apiBase(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("coach_api_base") || "http://localhost:8000";
}
export function token(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("coach_token") || "";
}
export function configured(): boolean {
  return Boolean(token());
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
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
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json();
}

export type ProgramSlot = {
  program_exercise_id: string;
  exercise_id: string;
  name: string;
  equipment: string;
  sets: number | null;
  reps: number | null;
  load_kg: number | null;
  image_urls: string[];
  cues: string[];
  position: number;
};
