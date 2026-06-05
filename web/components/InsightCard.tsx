"use client";
/* Proactive coach note on Today — a short, grounded "here's what I noticed". Tap it to
   discuss in the Coach tab; the refresh button (↻) rotates the focus (auto → weight →
   training → nutrition → vitals). Server-cached per (user, focus). Hidden when there's
   nothing to say or the coach LLM isn't configured. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { coachInsight, configured } from "@/lib/api";

const FOCUSES = ["auto", "weight", "training", "nutrition", "vitals"];

export default function InsightCard() {
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

  if (loading) return <div className="card p-4 h-[60px] animate-pulse rise" />;
  if (!note) return null;

  return (
    <div className="card p-4 rise" style={{ borderLeft: "2px solid var(--color-volt)" }}>
      <div className="flex items-start gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-volt)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
          <path d="M12 3v2M5 7l1.5 1.5M19 7l-1.5 1.5M9 17h6M10 21h4" />
          <path d="M12 5a5 5 0 0 0-3 9c.5.4.8 1 .9 1.6h4.2c.1-.6.4-1.2.9-1.6A5 5 0 0 0 12 5Z" />
        </svg>
        <button onClick={discuss} className="flex-1 min-w-0 text-left active:opacity-70">
          <p className="eyebrow mb-1">Coach</p>
          <p className="text-sm text-bone/90 leading-relaxed">{note}</p>
          <p className="text-volt text-xs mt-1.5 font-medium">Discuss →</p>
        </button>
        <button
          onClick={refresh}
          aria-label="refresh insight"
          className={`text-dim active:text-volt shrink-0 ${refreshing ? "animate-spin" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
