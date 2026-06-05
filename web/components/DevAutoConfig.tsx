"use client";
import { useEffect } from "react";

/* Dev convenience: when NEXT_PUBLIC_DEV_TOKEN is baked in (local single-user dev), sync
   the API base + token into localStorage on load so the app works with NO Setup step —
   and so a stale value (e.g. an old :8000 base) gets corrected. Disabled automatically in
   any build that doesn't define the env vars (e.g. a real deployment), where the Setup
   tab is used instead. */
export default function DevAutoConfig() {
  useEffect(() => {
    const tok = process.env.NEXT_PUBLIC_DEV_TOKEN;
    const url = process.env.NEXT_PUBLIC_API_URL;
    if (!tok) return;
    if (url) localStorage.setItem("coach_api_base", url);
    localStorage.setItem("coach_token", tok);
  }, []);
  return null;
}
