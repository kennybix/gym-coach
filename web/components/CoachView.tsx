"use client";
/* Coach. Has a face (CoachMark), a verdict-first weekly review, suggested prompts when a thread
   is empty, prose replies with the evidence chips, and a proper composer. Thread history and
   confirmations are sheets. Transcript persistence is unchanged. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coachChat, coachConfirm, coachLatestReview, coachThreadMessages, coachThreads, configured, offlineMessage,
  type CoachReply, type Review,
} from "@/lib/api";
import Markdown from "@/components/Markdown";
import { CoachMark } from "./CoachNote";
import Sheet from "./ui/Sheet";
import Empty from "./ui/Empty";

type Msg = { role: "user" | "coach" | "system"; text: string; evidence?: { label: string; detail: string }[] };
type Session = { id: string; title: string; msgs: Msg[]; updated: number };

const SKEY = "coach_sessions";
const AKEY = "coach_thread_id";
const PROMPTS = [
  "How did my week go?",
  "What should I focus on today?",
  "Why is my calorie target what it is?",
  "Plan a workout with no equipment",
];
const VERDICT: Record<string, { title: string; tone: string }> = {
  on_track: { title: "On track", tone: "var(--color-good)" },
  ahead: { title: "Ahead of plan", tone: "var(--color-good)" },
  behind: { title: "A little behind", tone: "var(--color-warn)" },
  stalled: { title: "Stalled this week", tone: "var(--color-warn)" },
  insufficient_data: { title: "Not enough logged yet", tone: "var(--color-dim)" },
};

const uuid = () => crypto.randomUUID();
const newSession = (): Session => ({ id: uuid(), title: "New chat", msgs: [], updated: Date.now() });
function titleFrom(msgs: Msg[]): string {
  const first = msgs.find((m) => m.role === "user");
  if (!first) return "";
  return first.text.length > 38 ? first.text.slice(0, 38) + "…" : first.text;
}
function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) { const s = JSON.parse(raw) as Session[]; if (Array.isArray(s) && s.length) return s; }
    const oldMsgs = JSON.parse(localStorage.getItem("coach_msgs") || "[]") as Msg[];
    const oldId = localStorage.getItem(AKEY);
    if (oldId || oldMsgs.length) return [{ id: oldId || uuid(), title: titleFrom(oldMsgs) || "New chat", msgs: oldMsgs, updated: Date.now() }];
  } catch {}
  return [newSession()];
}
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function reviewDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CoachView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ reason: string; diff?: { label: string; from: string; to: string }[] } | null>(null);
  const [review, setReview] = useState<Review>(null);
  const [ready, setReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [serverIds, setServerIds] = useState<Set<string>>(new Set());
  const fetched = useRef<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(configured());
    const s = loadSessions();
    setSessions(s);
    const stored = localStorage.getItem(AKEY);
    setActiveId(stored && s.some((x) => x.id === stored) ? stored : s[0].id);
    if (configured()) {
      coachLatestReview().then(setReview);
      coachThreads().then((threads) => {
        if (!threads.length) return;
        setServerIds(new Set(threads.map((t) => t.thread_id)));
        setSessions((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          for (const t of threads) if (!byId.has(t.thread_id)) byId.set(t.thread_id, { id: t.thread_id, title: t.title, msgs: [], updated: Date.parse(t.updated) || Date.now() });
          const ids = new Set(threads.map((t) => t.thread_id));
          return Array.from(byId.values()).filter((x) => x.msgs.length > 0 || byId.size === 1 || ids.has(x.id)).sort((a, b) => b.updated - a.updated);
        });
      });
    }
    const prefill = localStorage.getItem("coach_prefill");
    if (prefill) { setInput(prefill); localStorage.removeItem("coach_prefill"); }
  }, []);

  useEffect(() => {
    if (!ready || !sessions.length) return;
    localStorage.setItem(SKEY, JSON.stringify(sessions));
    if (activeId) localStorage.setItem(AKEY, activeId);
  }, [sessions, activeId, ready]);

  useEffect(() => {
    if (!activeId || !serverIds.has(activeId) || fetched.current.has(activeId)) return;
    const s = sessions.find((x) => x.id === activeId);
    if (!s || s.msgs.length > 0) return;
    fetched.current.add(activeId);
    coachThreadMessages(activeId).then((ms) => {
      if (!ms.length) return;
      const msgs: Msg[] = ms.map((m) => ({ role: m.role === "coach" ? "coach" : m.role === "system" ? "system" : "user", text: m.text, evidence: m.evidence || undefined }));
      setSessions((prev) => prev.map((x) => (x.id === activeId ? { ...x, msgs, title: x.title || titleFrom(msgs) } : x)));
    });
  }, [activeId, serverIds, sessions]);

  const active = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);
  const msgs = active?.msgs ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, confirm, busy]);

  const pushMsg = useCallback((m: Msg) => {
    setSessions((prev) => prev.map((s) => (s.id === activeId
      ? { ...s, msgs: [...s.msgs, m], title: s.title === "New chat" && m.role === "user" ? titleFrom([m]) : s.title, updated: Date.now() }
      : s)));
  }, [activeId]);

  const handle = useCallback((r: CoachReply) => {
    if (r.kind === "unavailable") pushMsg({ role: "system", text: offlineMessage(r.retryAt) });
    else if (r.kind === "reply") pushMsg({ role: "coach", text: r.text, evidence: r.evidence });
    else setConfirm({ reason: r.payload.reason, diff: r.payload.diff });
  }, [pushMsg]);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !activeId) return;
    setInput("");
    pushMsg({ role: "user", text });
    setBusy(true);
    try { handle(await coachChat(activeId, text)); }
    catch { pushMsg({ role: "system", text: "Couldn't reach the coach. Check your connection." }); }
    finally { setBusy(false); }
  }, [input, busy, activeId, pushMsg, handle]);

  const resolve = useCallback(async (approved: boolean) => {
    setConfirm(null); setBusy(true);
    try { handle(await coachConfirm(activeId, approved)); } finally { setBusy(false); }
  }, [activeId, handle]);

  const startNewChat = useCallback(() => {
    setConfirm(null); setShowHistory(false);
    const empty = sessions.find((s) => s.msgs.length === 0);
    if (empty) return setActiveId(empty.id);
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [sessions]);
  const openChat = (id: string) => { setConfirm(null); setShowHistory(false); setActiveId(id); };
  const deleteChat = (id: string) => setSessions((prev) => {
    const next = prev.filter((s) => s.id !== id);
    const list = next.length ? next : [newSession()];
    if (id === activeId) setActiveId(list[0].id);
    return list;
  });

  const v = review ? VERDICT[review.status] ?? { title: review.status.replace("_", " "), tone: "var(--color-dim)" } : null;
  const adaptive = (review?.changes as { adaptive?: { recommendation?: string; estimated_maintenance_kcal?: number | null; confidence?: string } } | undefined)?.adaptive;
  const targetChange = (review?.changes as { target_change?: { new_daily_kcal: number; previous_daily_kcal?: number | null } } | undefined)?.target_change;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 rise">
        <div className="flex items-center gap-3 min-w-0">
          <CoachMark size={40} />
          <div className="min-w-0">
            <h1 className="t-title">Coach</h1>
            <p className="t-sec truncate">{active && active.msgs.length ? active.title : "Reads your logs before answering"}</p>
          </div>
        </div>
        {ready && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowHistory(true)} aria-label="Chat history" className="iconbtn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
            </button>
            <button onClick={startNewChat} aria-label="New chat" className="iconbtn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        )}
      </header>

      {!ready && <div className="card p-5"><Empty line="Paste your access token once and the coach comes online." action="Open Setup" href="/settings" compact /></div>}

      {ready && review && v && msgs.length === 0 && (
        <section className="card-lift p-5 rise" data-testid="weekly-review">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Weekly review · {reviewDate(review.created_at)}</p>
            <span className="w-2 h-2 rounded-full" style={{ background: v.tone }} aria-hidden />
          </div>
          <p className="t-h2 mt-2" style={{ color: v.tone === "var(--color-dim)" ? "var(--color-bone)" : v.tone }}>{v.title}</p>
          <div className="text-[15px] leading-relaxed mt-2 text-bone/90"><Markdown>{review.summary}</Markdown></div>
          {(targetChange || (adaptive && adaptive.estimated_maintenance_kcal)) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {targetChange && <span className="chip chip-on px-2.5 py-1 text-[11px] font-semibold tnum">Target {targetChange.previous_daily_kcal ?? "–"} → {targetChange.new_daily_kcal} kcal</span>}
              {adaptive?.estimated_maintenance_kcal && <span className="chip px-2.5 py-1 text-[11px] text-dim tnum">~{adaptive.estimated_maintenance_kcal} kcal/day · {adaptive.confidence}</span>}
            </div>
          )}
        </section>
      )}

      {ready && (
        <div className="space-y-4 min-h-[36dvh] pb-2">
          {msgs.length === 0 && (
            <div className="rise">
              <p className="eyebrow mb-2">Ask</p>
              <div className="flex flex-wrap gap-2">
                {PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)} disabled={busy} className="chip px-3.5 py-2 text-sm text-bone/90 active:border-volt active:text-volt">{p}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => <Bubble key={i} m={m} />)}
          {confirm && (
            <div className="card-lift p-4">
              <p className="eyebrow mb-1.5">Confirm change</p>
              <p className="text-[15px] leading-snug">{confirm.reason}</p>
              {confirm.diff && confirm.diff.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {confirm.diff.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="t-sec w-24 shrink-0 truncate">{d.label}</span>
                      <span className="text-dim tnum line-through">{d.from}</span>
                      <span className="text-dim">→</span>
                      <span className="text-volt tnum font-semibold">{d.to}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2.5 mt-4">
                <button onClick={() => resolve(true)} className="btn btn-primary flex-1 h-12">Approve</button>
                <button onClick={() => resolve(false)} className="btn btn-ghost flex-1 h-12">Not now</button>
              </div>
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-3">
              <CoachMark size={28} />
              <span className="flex items-center gap-1.5 text-dim">
                <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce" />
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {ready && (
        <div className="fixed inset-x-0 z-30 border-t border-line bg-ink/85 backdrop-blur-xl" style={{ bottom: "calc(63px + env(safe-area-inset-bottom))" }}>
          <div className="max-w-md mx-auto p-3 flex gap-2.5">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message your coach" className="field flex-1 h-12 px-4 text-[15px] outline-none" />
            <button onClick={() => send()} disabled={busy || !input.trim()} aria-label="Send" className="btn btn-primary w-12 h-12 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </div>
      )}

      <Sheet open={showHistory} onClose={() => setShowHistory(false)} title="Chats">
        <div className="max-h-[56dvh] overflow-auto scroll-soft">
          {sessions.slice().sort((a, b) => b.updated - a.updated).map((s) => (
            <div key={s.id} className={`row ${s.id === activeId ? "text-volt" : ""}`}>
              <button onClick={() => openChat(s.id)} className="flex-1 text-left min-w-0">
                <p className="text-[15px] truncate font-medium">{s.title || "New chat"}</p>
                <p className="t-sec tnum">{s.msgs.length} message{s.msgs.length === 1 ? "" : "s"} · {ago(s.updated)}</p>
              </button>
              <button onClick={() => deleteChat(s.id)} aria-label="delete chat" className="text-dim active:text-alert px-2 text-xl leading-none">×</button>
            </div>
          ))}
        </div>
        <button onClick={startNewChat} className="btn btn-ghost w-full h-12 mt-4">+ New chat</button>
      </Sheet>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "system") return <p className="text-center t-sec px-6">{m.text}</p>;
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[84%] px-4 py-2.5 text-[15px] leading-relaxed bg-volt text-onvolt rounded-2xl rounded-br-md font-medium break-words">{m.text}</div>
      </div>
    );
  return (
    <div className="flex items-start gap-3">
      <CoachMark size={28} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-[15px] leading-relaxed text-bone/95 break-words"><Markdown>{m.text}</Markdown></div>
        {m.evidence && m.evidence.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.evidence.map((e, i) => (
              <span key={i} className="chip px-2 py-0.5 text-[11px] text-dim max-w-full break-words">
                <span className="text-bone/80">{e.label}</span> {e.detail}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
