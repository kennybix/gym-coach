"use client";
/* The coach speaks in one line on Home. Grounded server-side (coach/insight.py), cached per
   user. Tap to take it into the Coach tab; the small refresh rotates the focus. Renders
   nothing when the coach is off or has nothing to say — never a placeholder paragraph. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { coachInsight, configured } from "@/lib/api";

const FOCUSES = ["auto", "weight", "training", "nutrition", "vitals"];

export function CoachMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: "color-mix(in srgb, var(--color-volt) 18%, transparent)" }}
      aria-hidden
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="var(--color-volt)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
      </svg>
    </span>
  );
}

export default function CoachNote() {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const focusIdx = useRef(0);

  const fetchIt = useCallback((refresh: boolean) => {
    coachInsight(refresh, FOCUSES[focusIdx.current])
      .then((d) => setNote(d?.note ?? null))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (!configured()) {
      setLoading(false);
      return;
    }
    fetchIt(false);
  }, [fetchIt]);

  const refresh = () => {
    setRefreshing(true);
    focusIdx.current = (focusIdx.current + 1) % FOCUSES.length;
    fetchIt(true);
  };

  const discuss = () => {
    if (!note) return;
    try {
      localStorage.setItem("coach_prefill", `About your note: "${note}" — can you expand on this?`);
    } catch {}
    router.push("/coach");
  };

  if (loading) return <div className="h-14 rounded-2xl bg-panel animate-pulse" />;
  if (!note) return null;

  return (
    <div className="flex items-start gap-3 rise">
      <CoachMark />
      <button onClick={discuss} className="flex-1 min-w-0 text-left active:opacity-70">
        <p className="text-[15px] leading-snug text-bone/95">{note}</p>
        <p className="eyebrow mt-1.5" style={{ color: "var(--color-volt)" }}>Coach · tap to discuss</p>
      </button>
      <button onClick={refresh} aria-label="another note" className={`text-dim active:text-bone shrink-0 mt-1 ${refreshing ? "animate-spin" : ""}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4" />
        </svg>
      </button>
    </div>
  );
}
