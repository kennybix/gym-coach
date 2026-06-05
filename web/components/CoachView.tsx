"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  coachChat,
  coachConfirm,
  coachLatestReview,
  configured,
  type CoachReply,
  type Review,
} from "@/lib/api";
import Markdown from "@/components/Markdown";

type Msg = { role: "user" | "coach" | "system"; text: string };
type Session = { id: string; title: string; msgs: Msg[]; updated: number };

const SKEY = "coach_sessions";
const AKEY = "coach_thread_id"; // active thread id (also the backend checkpoint key)

function uuid(): string {
  return crypto.randomUUID();
}
function newSession(): Session {
  return { id: uuid(), title: "New chat", msgs: [], updated: Date.now() };
}

/* Load sessions, migrating the previous single-thread storage (coach_msgs + coach_thread_id)
   into a session so existing history isn't lost. Always returns at least one session. */
function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) {
      const s = JSON.parse(raw) as Session[];
      if (Array.isArray(s) && s.length) return s;
    }
    const oldMsgs = JSON.parse(localStorage.getItem("coach_msgs") || "[]") as Msg[];
    const oldId = localStorage.getItem(AKEY);
    if (oldId || oldMsgs.length) {
      return [{ id: oldId || uuid(), title: titleFrom(oldMsgs) || "New chat", msgs: oldMsgs, updated: Date.now() }];
    }
  } catch {
    /* fall through to a fresh session */
  }
  return [newSession()];
}

function titleFrom(msgs: Msg[]): string {
  const first = msgs.find((m) => m.role === "user");
  if (!first) return "";
  return first.text.length > 38 ? first.text.slice(0, 38) + "…" : first.text;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CoachView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ reason: string } | null>(null);
  const [review, setReview] = useState<Review>(null);
  const [ready, setReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReady(configured());
    const s = loadSessions();
    setSessions(s);
    const stored = localStorage.getItem(AKEY);
    setActiveId(stored && s.some((x) => x.id === stored) ? stored : s[0].id);
    if (configured()) coachLatestReview().then(setReview);
    // a tapped Today insight hands off a question to start from
    const prefill = localStorage.getItem("coach_prefill");
    if (prefill) {
      setInput(prefill);
      localStorage.removeItem("coach_prefill");
    }
  }, []);

  useEffect(() => {
    if (!ready || !sessions.length) return;
    localStorage.setItem(SKEY, JSON.stringify(sessions));
    if (activeId) localStorage.setItem(AKEY, activeId);
  }, [sessions, activeId, ready]);

  const active = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);
  const msgs = active?.msgs ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, confirm]);

  const pushMsg = useCallback(
    (m: Msg) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                msgs: [...s.msgs, m],
                title: s.title === "New chat" && m.role === "user" ? titleFrom([m]) : s.title,
                updated: Date.now(),
              }
            : s
        )
      );
    },
    [activeId]
  );

  const handle = useCallback(
    (r: CoachReply) => {
      if (r.kind === "unavailable") {
        pushMsg({ role: "system", text: "Coach is offline — add your LLM key on the server to enable chat." });
      } else if (r.kind === "reply") {
        pushMsg({ role: "coach", text: r.text });
      } else {
        setConfirm({ reason: r.payload.reason });
      }
    },
    [pushMsg]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !activeId) return;
    setInput("");
    pushMsg({ role: "user", text });
    setBusy(true);
    try {
      handle(await coachChat(activeId, text));
    } catch {
      pushMsg({ role: "system", text: "Couldn't reach the coach. Check your connection." });
    } finally {
      setBusy(false);
    }
  }, [input, busy, activeId, pushMsg, handle]);

  const resolve = useCallback(
    async (approved: boolean) => {
      setConfirm(null);
      setBusy(true);
      try {
        handle(await coachConfirm(activeId, approved));
      } finally {
        setBusy(false);
      }
    },
    [activeId, handle]
  );

  const startNewChat = useCallback(() => {
    setConfirm(null);
    setShowHistory(false);
    const empty = sessions.find((s) => s.msgs.length === 0);
    if (empty) {
      setActiveId(empty.id);
      return;
    }
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [sessions]);

  const openChat = useCallback((id: string) => {
    setConfirm(null);
    setShowHistory(false);
    setActiveId(id);
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        const list = next.length ? next : [newSession()];
        if (id === activeId) setActiveId(list[0].id);
        return list;
      });
    },
    [activeId]
  );

  if (!ready)
    return (
      <Wrap title="" onNew={startNewChat} onToggleHistory={() => {}} hideControls>
        <div className="card p-5"><p className="text-dim text-sm">Set your token on Setup to talk to your coach.</p></div>
      </Wrap>
    );

  return (
    <Wrap
      title={active?.title ?? "New chat"}
      onNew={startNewChat}
      onToggleHistory={() => setShowHistory((v) => !v)}
      historyOpen={showHistory}
    >
      {showHistory && (
        <div className="card divide-y divide-line rise max-h-[52dvh] overflow-auto scroll-soft">
          {sessions
            .slice()
            .sort((a, b) => b.updated - a.updated)
            .map((s) => (
              <div key={s.id} className={`flex items-center gap-2 px-4 py-3 ${s.id === activeId ? "bg-panel2" : ""}`}>
                <button onClick={() => openChat(s.id)} className="flex-1 text-left min-w-0">
                  <p className="text-sm text-bone truncate font-medium">{s.title || "New chat"}</p>
                  <p className="text-[11px] text-dim tnum mt-0.5">
                    {s.msgs.length} message{s.msgs.length === 1 ? "" : "s"} · {ago(s.updated)}
                  </p>
                </button>
                <button
                  onClick={() => deleteChat(s.id)}
                  aria-label="delete chat"
                  className="text-dim hover:text-alert px-2 py-1 text-xl leading-none rounded-lg"
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      )}

      {review && (
        <div className="card p-5 rise">
          <div className="flex items-center justify-between mb-2.5">
            <p className="eyebrow">This week</p>
            <span className="chip px-2.5 py-1 text-[11px] font-semibold text-volt border-volt/40 capitalize">
              {review.status.replace("_", " ")}
            </span>
          </div>
          <div className="text-bone/90"><Markdown>{review.summary}</Markdown></div>
        </div>
      )}

      <div className="space-y-3 min-h-[42dvh] pb-2">
        {msgs.length === 0 && !review && (
          <div className="card p-6 text-center rise">
            <p className="text-dim text-sm leading-relaxed">
              Ask your coach anything — how your week went, whether to adjust, what to do with no
              equipment. It reads your actual logs before answering.
            </p>
          </div>
        )}
        {msgs.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {confirm && (
          <div className="card p-4 border-volt/50">
            <p className="text-sm text-bone/90 mb-2">{confirm.reason}</p>
            <p className="text-dim text-xs mb-3">This is a sizeable change — confirm to apply it.</p>
            <div className="flex gap-2.5">
              <button onClick={() => resolve(true)} className="btn btn-primary flex-1 h-11">Approve</button>
              <button onClick={() => resolve(false)} className="btn btn-ghost flex-1 h-11">Decline</button>
            </div>
          </div>
        )}
        {busy && <Thinking />}
        <div ref={endRef} />
      </div>

      <div
        className="fixed inset-x-0 z-30 border-t border-line bg-ink/85 backdrop-blur-xl"
        style={{ bottom: "calc(63px + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-md mx-auto p-3 flex gap-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message your coach"
            className="field flex-1 h-12 px-4 text-sm outline-none"
          />
          <button onClick={send} disabled={busy} className="btn btn-primary px-5">Send</button>
        </div>
      </div>
    </Wrap>
  );
}

function Wrap({
  children, title, onNew, onToggleHistory, historyOpen, hideControls,
}: {
  children: React.ReactNode;
  title?: string;
  onNew: () => void;
  onToggleHistory: () => void;
  historyOpen?: boolean;
  hideControls?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rise">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-bold leading-none">Coach</h1>
          {!hideControls && title ? (
            <p className="text-dim text-xs mt-1.5 truncate">{title}</p>
          ) : null}
        </div>
        {!hideControls && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleHistory}
              className={`btn h-9 px-3.5 text-xs ${historyOpen ? "bg-volt text-ink" : "btn-ghost"}`}
            >
              History
            </button>
            <button onClick={onNew} className="btn btn-primary h-9 px-3.5 text-xs">+ New</button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 pl-1 text-dim">
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce" />
    </div>
  );
}

function Bubble({ role, text }: { role: Msg["role"]; text: string }) {
  if (role === "system")
    return <p className="text-center text-dim text-xs px-6 py-1">{text}</p>;
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[84%] px-4 py-2.5 text-sm leading-relaxed ${
          mine
            ? "bg-volt text-ink rounded-2xl rounded-br-md font-medium"
            : "card rounded-2xl rounded-bl-md text-bone/90"
        }`}
      >
        {mine ? text : <Markdown>{text}</Markdown>}
      </div>
    </div>
  );
}
